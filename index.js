// index.js

const express = require('express');
const { authenticatedLndGrpc } = require('ln-service');
const {
    getWalletInfo,
    getChainBalance,
    getChannelBalance,
    getChannels,
    createInvoice,
    getInvoices,
    pay,
    signMessage,
    verifyMessage,
} = require('ln-service');
const dotenv = require('dotenv');
const cors = require('cors');

dotenv.config();

const app = express();
const MAX_NODES = 3;

/** @type {Map<string, { lnd: object, socket: string }>} */
const lndNodes = new Map();

app.use(cors());
app.use(express.json());

function getNodeEnv(index, legacy = false) {
    if (legacy) {
        return {
            id: process.env.LND_NODE_ID_1 || process.env.LND_NODE_ID || '1',
            socket: process.env.LND_GRPC_HOST,
            macaroon: process.env.LND_MACAROON_BASE64,
            cert: process.env.LND_TLS_CERT_BASE64,
        };
    }

    return {
        id: process.env[`LND_NODE_ID_${index}`] || String(index),
        socket: process.env[`LND_GRPC_HOST_${index}`],
        macaroon: process.env[`LND_MACAROON_BASE64_${index}`],
        cert: process.env[`LND_TLS_CERT_BASE64_${index}`],
    };
}

function loadNodeConfigs() {
    const configs = [];
    const seenIds = new Set();

    const hasNumberedNode1 = Boolean(process.env.LND_GRPC_HOST_1);
    if (!hasNumberedNode1 && process.env.LND_GRPC_HOST) {
        configs.push(getNodeEnv(1, true));
    }

    for (let index = 1; index <= MAX_NODES; index += 1) {
        const { id, socket, macaroon, cert } = getNodeEnv(index);
        const hasAny = Boolean(socket || macaroon || cert);
        if (!hasAny) {
            continue;
        }

        if (!socket || !macaroon || !cert) {
            console.error(`Incomplete LND config for node slot ${index}.`);
            console.error(`Provide LND_GRPC_HOST_${index}, LND_MACAROON_BASE64_${index}, and LND_TLS_CERT_BASE64_${index}.`);
            process.exit(1);
        }

        if (seenIds.has(id)) {
            console.error(`Duplicate LND node id "${id}". Each node must have a unique LND_NODE_ID_N value.`);
            process.exit(1);
        }

        seenIds.add(id);
        configs.push({ id, socket, macaroon, cert });
    }

    if (configs.length === 0) {
        console.error('No LND nodes configured.');
        console.error('Provide node 1 credentials via LND_GRPC_HOST / LND_MACAROON_BASE64 / LND_TLS_CERT_BASE64');
        console.error('or via LND_GRPC_HOST_1 / LND_MACAROON_BASE64_1 / LND_TLS_CERT_BASE64_1 (up to 3 nodes).');
        process.exit(1);
    }

    if (configs.length > MAX_NODES) {
        console.error(`At most ${MAX_NODES} LND nodes are supported.`);
        process.exit(1);
    }

    return configs;
}

function connectToLndNodes() {
    const configs = loadNodeConfigs();

    for (const config of configs) {
        try {
            const { lnd } = authenticatedLndGrpc({
                socket: config.socket,
                macaroon: config.macaroon,
                cert: config.cert,
            });

            lndNodes.set(config.id, { lnd, socket: config.socket });
            console.log(`Connected to LND node "${config.id}" at ${config.socket}`);
        } catch (error) {
            console.error(`Failed to connect to LND node "${config.id}":`, error.message);
            process.exit(1);
        }
    }
}

const resolveLndNode = (req, res, next) => {
    const node = lndNodes.get(req.params.nodeId);
    if (!node) {
        return res.status(404).json({
            error: `Unknown LND node "${req.params.nodeId}".`,
            availableNodes: [...lndNodes.keys()],
        });
    }

    req.lnd = node.lnd;
    req.nodeId = req.params.nodeId;
    next();
};

const attachDefaultLnd = (req, res, next) => {
    const defaultNodeId = [...lndNodes.keys()][0];
    const node = lndNodes.get(defaultNodeId);
    req.lnd = node.lnd;
    req.nodeId = defaultNodeId;
    next();
};

async function handleGetInfo(req, res) {
    try {
        const info = await getWalletInfo({ lnd: req.lnd });
        res.json(info);
    } catch (error) {
        console.error(`[${req.nodeId}] Error getting node info:`, error);
        res.status(500).json({ error: 'Failed to get node info.', details: error });
    }
}

async function handleGetBalance(req, res) {
    try {
        const onChainBalance = await getChainBalance({ lnd: req.lnd });
        const offChainBalance = await getChannelBalance({ lnd: req.lnd });
        res.json({ onChainBalance, offChainBalance });
    } catch (error) {
        console.error(`[${req.nodeId}] Error getting balance:`, error);
        res.status(500).json({ error: 'Failed to get balance.', details: error });
    }
}

async function handleGetChannels(req, res) {
    try {
        const {channels} = await getChannels({lnd: req.lnd});

        const liquidity = channels.map((ch) => ({
            channel_id: ch.id,
            partner: ch.partner_public_key,
            capacity: ch.capacity,
            outbound_capacity: ch.local_balance,
            inbound_capacity: ch.remote_balance,
            unsettled_balance: ch.unsettled_balance,
            sent: ch.sent,
            received: ch.received,
            is_active: ch.is_active,
            is_private: ch.is_private,
            is_closing: ch.is_closing,
            is_opening: ch.is_opening,
            transaction_id : ch.transaction_id,
            transaction_vout: ch.transaction_vout,
        }))

        res.json({
            nodeId: req.nodeId,
            count: liquidity.length,
            channels: liquidity,
        })
    } catch (error) {
        console.error(`[${req.nodeId}] Error getting channels:`, error);
        res.status(500).json({ error: 'Failed to get channels.', details: error });
    }
}

async function handleCreateInvoice(req, res) {
    try {
        const { sats, description } = req.body;

        if (sats === undefined || typeof sats !== 'number' || sats <= 0) {
            return res.status(400).json({ error: 'A positive numeric `sats` value is required.' });
        }

        const invoice = await createInvoice({
            lnd: req.lnd,
            tokens: sats,
            description: description || '',
        });

        res.json(invoice);
    } catch (error) {
        console.error(`[${req.nodeId}] Error creating invoice:`, error);
        res.status(500).json({ error: 'Failed to create invoice.', details: error });
    }
}

async function handleListInvoices(req, res) {
    try {
        const { invoices } = await getInvoices({ lnd: req.lnd });
        res.json(invoices);
    } catch (error) {
        console.error(`[${req.nodeId}] Error listing invoices:`, error);
        res.status(500).json({ error: 'Failed to list invoices.', details: error });
    }
}

async function handlePay(req, res) {
    try {
        const { request } = req.body;

        if (!request) {
            return res.status(400).json({ error: 'A `request` string (BOLT11 invoice) is required.' });
        }

        const paymentResult = await pay({ lnd: req.lnd, request });
        res.json({ success: true, payment_info: paymentResult });
    } catch (error) {
        console.error(`[${req.nodeId}] Error paying invoice:`, error);
        res.status(500).json({ error: 'Failed to pay invoice.', details: error });
    }
}

async function handleSignMessage(req, res) {
    try {
        const { message } = req.body;
        if (!message || typeof message !== 'string') {
            return res.status(400).json({ error: 'A `message` string is required.' });
        }

        const { signature } = await signMessage({
            lnd: req.lnd,
            message: Buffer.from(message, 'utf8'),
        });

        res.json({ message, signature });
    } catch (error) {
        console.error(`[${req.nodeId}] Error signing message:`, error);
        res.status(500).json({ error: 'Failed to sign message.', details: error });
    }
}

async function handleVerifyMessage(req, res) {
    try {
        const { message, signature, pubkey } = req.body;

        if (!message || !signature || !pubkey) {
            return res.status(400).json({ error: 'All three params are required.' });
        }

        const isValid = await verifyMessage({
            lnd: req.lnd,
            message: Buffer.from(message, 'utf8'),
            signature,
            public_key: pubkey,
        });

        res.json({ isValid });
    } catch (error) {
        console.error(`[${req.nodeId}] Error verifying message:`, error);
        res.status(500).json({ error: 'Failed to verify message.', details: error });
    }
}

function registerNodeRoutes(middleware) {
    app.get('/api/nodes/:nodeId/getinfo', middleware, handleGetInfo);
    app.get('/api/nodes/:nodeId/balance', middleware, handleGetBalance);
    app.get('/api/nodes/:nodeId/channels', middleware, handleGetChannels);
    app.get('/api/nodes/:nodeId/invoices', middleware, handleListInvoices);
    app.post('/api/nodes/:nodeId/invoice', middleware, handleCreateInvoice);
    app.post('/api/nodes/:nodeId/pay', middleware, handlePay);
    app.post('/api/nodes/:nodeId/signmessage', middleware, handleSignMessage);
    app.post('/api/nodes/:nodeId/verifymessage', middleware, handleVerifyMessage);
}

app.get('/api/nodes', (req, res) => {
    res.json({
        maxNodes: MAX_NODES,
        connectedNodes: [...lndNodes.entries()].map(([id, node]) => ({
            id,
            grpcHost: node.socket,
        })),
    });
});

registerNodeRoutes(resolveLndNode);

// Legacy routes (first configured node) for backward compatibility
app.get('/api/getinfo', attachDefaultLnd, handleGetInfo);
app.get('/api/balance', attachDefaultLnd, handleGetBalance);
app.get('/api/invoices', attachDefaultLnd, handleListInvoices);
app.get('/api/channels', attachDefaultLnd, handleGetChannels);
app.post('/api/invoice', attachDefaultLnd, handleCreateInvoice);
app.post('/api/pay', attachDefaultLnd, handlePay);
app.post('/api/signmessage', attachDefaultLnd, handleSignMessage);
app.post('/api/verifymessage', attachDefaultLnd, handleVerifyMessage);

const PORT = process.env.PORT || 5003;

connectToLndNodes();

app.listen(PORT, () => {
    const nodeIds = [...lndNodes.keys()];

    console.log(`API Server using 'ln-service' is running on http://localhost:${PORT}`);
    console.log(`Connected nodes (${nodeIds.length}/${MAX_NODES}): ${nodeIds.join(', ')}`);
    console.log('----------------------------------------------------');
    console.log('Discovery:');
    console.log('- GET    /api/nodes');
    console.log('Node-scoped endpoints (replace :nodeId with one of the ids above):');
    console.log('- GET    /api/nodes/:nodeId/getinfo');
    console.log('- GET    /api/nodes/:nodeId/balance');
    console.log('- GET    /api/nodes/:nodeId/invoices');
    console.log('- POST   /api/nodes/:nodeId/invoice');
    console.log('- POST   /api/nodes/:nodeId/pay');
    console.log('- POST   /api/nodes/:nodeId/signmessage');
    console.log('- POST   /api/nodes/:nodeId/verifymessage');
    console.log('Legacy endpoints (first configured node only):');
    console.log('- GET    /api/getinfo');
    console.log('- GET    /api/balance');
    console.log('- GET    /api/invoices');
    console.log('- POST   /api/invoice');
    console.log('- POST   /api/pay');
    console.log('- POST   /api/signmessage');
    console.log('- POST   /api/verifymessage');
    console.log('----------------------------------------------------');
});
