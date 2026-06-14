# LND Express API Server

API backend construite avec Node.js + Express pour interagir avec un noeud **LND (Lightning Network Daemon)** via la librairie [`ln-service`](https://www.npmjs.com/package/ln-service).

Ce service expose des endpoints REST pour:

- recuperer les informations du wallet/noeud,
- consulter les balances on-chain et Lightning,
- lister les canaux ouverts et leur liquidite par canal,
- creer et lister des factures Lightning,
- payer une facture BOLT11,
- signer et verifier des messages.

## Vue d'ensemble du projet

Le serveur:

- initialise une connexion gRPC authentifiee vers LND au demarrage,
- applique un middleware global qui bloque les requetes si LND est indisponible,
- expose des routes REST sous le prefixe `/api`,
- renvoie des reponses JSON utilisables depuis Postman, curl, ou un frontend.

Stack principale:

- `express` pour l'API HTTP
- `ln-service` pour les appels a LND
- `dotenv` pour la configuration
- `cors` pour autoriser les appels cross-origin
- `nodemon` en mode developpement

## Prerequis

- Node.js 14+ (Node.js 18+ recommande)
- Un noeud LND actif et accessible en gRPC
- Les credentials LND:
  - hote/port gRPC (`host:port`, ex: `127.0.0.1:10009`)
  - `admin.macaroon` encode en base64
  - `tls.cert` encode en base64

## Installation

1. Cloner le repository:

```bash
git clone <url-du-repo>
cd connect-lnd
```

1. Installer les dependances:

```bash
npm install
```

## Configuration (.env)

Creer un fichier `.env` a la racine du projet. Le serveur supporte **jusqu'a 3 noeuds LND** en parallele.

### Option A — un seul noeud (legacy)

```env
PORT=5003
LND_GRPC_HOST=127.0.0.1:10009
LND_MACAROON_BASE64=<votre_admin_macaroon_base64>
LND_TLS_CERT_BASE64=<votre_tls_cert_base64>
```

### Option B — jusqu'a 3 noeuds (recommande)

```env
PORT=5003

LND_NODE_ID_1=alice
LND_GRPC_HOST_1=127.0.0.1:10009
LND_MACAROON_BASE64_1=<macaroon_alice_base64>
LND_TLS_CERT_BASE64_1=<tls_alice_base64>

LND_NODE_ID_2=bob
LND_GRPC_HOST_2=127.0.0.1:10010
LND_MACAROON_BASE64_2=<macaroon_bob_base64>
LND_TLS_CERT_BASE64_2=<tls_bob_base64>

LND_NODE_ID_3=carol
LND_GRPC_HOST_3=127.0.0.1:10011
LND_MACAROON_BASE64_3=<macaroon_carol_base64>
LND_TLS_CERT_BASE64_3=<tls_carol_base64>
```

- `LND_NODE_ID_N` est optionnel (defaut: `"1"`, `"2"`, `"3"`) et sert d'identifiant dans les URLs (`/api/nodes/alice/...`).
- Les slots 2 et 3 sont optionnels; seuls les noeuds completement configures sont demarres.
- Si `LND_GRPC_HOST_1` est defini, la config legacy (`LND_GRPC_HOST` sans suffixe) est ignoree pour le slot 1.

### Comment obtenir les valeurs base64

Exemple Linux/macOS:

```bash
base64 -w 0 ~/.lnd/data/chain/bitcoin/mainnet/admin.macaroon
base64 -w 0 ~/.lnd/tls.cert
```

> Sur certains systemes macOS, utilisez `base64 <fichier>` (sans `-w 0`).

### Ou trouver le macaroon dans Polar

Si vous utilisez **Polar** pour lancer votre noeud LND:

- Ouvrez Polar, puis cliquez sur votre noeud (ex: Alice/Bob).
- Allez dans l'onglet de connexion/credentials (Connect / REST / gRPC selon la version).
- Polar affiche le `admin.macaroon`, le `tls.cert` et l'adresse gRPC, que vous pouvez copier.
- Vous pouvez ensuite convertir le macaroon et le certificat en base64 pour remplir:
  - `LND_MACAROON_BASE64`
  - `LND_TLS_CERT_BASE64`

Selon votre configuration locale, les fichiers se trouvent souvent dans les volumes Docker de Polar (chemins variables selon OS/version). Le plus fiable reste de recuperer les valeurs directement depuis l'interface Polar.

### Important securite

- Le fichier `.env` contient des secrets sensibles.
- Ne le committez jamais.
- Evitez de partager vos valeurs `LND_MACAROON_BASE64` et `LND_TLS_CERT_BASE64`.

## Lancer le projet

### Production

```bash
npm start
```

### Developpement (reload automatique)

```bash
npm run dev
```

Si la connexion a LND est correcte, vous verrez un message de succes dans la console et la liste des endpoints disponibles.

## Base URL

Par defaut:

`http://localhost:5003`

## Endpoints et formats de requetes

Toutes les reponses sont en JSON.

### Lister les noeuds connectes

- **Method**: `GET`
- **Route**: `/api/nodes`
- **Exemple curl**:

```bash
curl -X GET http://localhost:5003/api/nodes
```

### Routes par noeud

Pour cibler un noeud specifique, prefixez les routes avec `/api/nodes/:nodeId` (ex: `/api/nodes/alice/getinfo`).

Les routes legacy sans `:nodeId` (`/api/getinfo`, etc.) utilisent toujours le **premier noeud configure**.

### 1) Recuperer les infos du noeud

- **Method**: `GET`
- **Route**: `/api/nodes/:nodeId/getinfo` ou `/api/getinfo` (legacy)
- **Body**: aucun
- **Exemple curl**:

```bash
curl -X GET http://localhost:5003/api/getinfo
```

### 2) Recuperer les balances

- **Method**: `GET`
- **Route**: `/api/nodes/:nodeId/balance` ou `/api/balance` (legacy)
- **Body**: aucun
- **Exemple curl**:

```bash
curl -X GET http://localhost:5003/api/balance
```

> **Difference avec `/channels`**: `/balance` renvoie un total agrege (`offChainBalance`). `/channels` detaille chaque canal ouvert avec sa liquidite sortante et entrante.

### 3) Lister les canaux et la liquidite

- **Method**: `GET`
- **Route**: `/api/nodes/:nodeId/channels` ou `/api/channels` (legacy)
- **Body**: aucun
- **Description**: retourne tous les canaux Lightning ouverts du noeud, avec la capacite de liquidite par canal (via `ln-service` / `getChannels`).
- **Exemple curl**:

```bash
curl -X GET http://localhost:5003/api/nodes/alice/channels
```

Legacy (premier noeud configure):

```bash
curl -X GET http://localhost:5003/api/channels
```

- **Reponse (JSON)** — structure typique:

```json
{
  "nodeId": "alice",
  "count": 1,
  "channels": [
    {
      "channel_id": "...",
      "partner": "02...",
      "capacity": 1000000,
      "outbound_capacity": 500000,
      "inbound_capacity": 500000,
      "unsettled_balance": 0,
      "sent": 0,
      "received": 0,
      "is_active": true,
      "is_private": false,
      "is_closing": false,
      "is_opening": false,
      "transaction_id": "...",
      "transaction_vout": 0
    }
  ]
}
```

- **Champs utiles pour la liquidite**:

| Champ | Signification |
|-------|---------------|
| `outbound_capacity` | Liquidite sortante (satoshis que vous pouvez envoyer) |
| `inbound_capacity` | Liquidite entrante (satoshis que vous pouvez recevoir) |
| `capacity` | Taille totale du canal |
| `unsettled_balance` | Montant en vol (HTLC non regles) |
| `is_active` | Canal utilisable pour le routage |
| `partner` | Cle publique du noeud pair |

- Un canal est **bidirectionnel** (liquidite utilisable dans les deux sens) lorsque `outbound_capacity > 0` **et** `inbound_capacity > 0`.
- Si `count` vaut `0`, le noeud n'a pas encore de canal ouvert (ouvrez-en un dans Polar, puis minez un bloc).

### 4) Creer une facture Lightning

- **Method**: `POST`
- **Route**: `/api/nodes/:nodeId/invoice` ou `/api/invoice` (legacy)
- **Headers**: `Content-Type: application/json`
- **Body (JSON)**:

```json
{
  "sats": 1000,
  "description": "Paiement test"
}
```

- `sats` est obligatoire, numerique, et > 0.
- `description` est optionnel.
- **Exemple curl**:

```bash
curl -X POST http://localhost:5003/api/invoice \
  -H "Content-Type: application/json" \
  -d '{"sats":1000,"description":"Paiement test"}'
```

### 5) Lister les factures

- **Method**: `GET`
- **Route**: `/api/nodes/:nodeId/invoices` ou `/api/invoices` (legacy)
- **Body**: aucun
- **Exemple curl**:

```bash
curl -X GET http://localhost:5003/api/invoices
```

### 6) Payer une facture BOLT11

- **Method**: `POST`
- **Route**: `/api/nodes/:nodeId/pay` ou `/api/pay` (legacy)
- **Headers**: `Content-Type: application/json`
- **Body (JSON)**:

```json
{
  "request": "lnbc1..."
}
```

- `request` est obligatoire (chaine BOLT11 complete).
- **Exemple curl**:

```bash
curl -X POST http://localhost:5003/api/pay \
  -H "Content-Type: application/json" \
  -d '{"request":"lnbc1..."}'
```

### 7) Signer un message

- **Method**: `POST`
- **Route**: `/api/nodes/:nodeId/signmessage` ou `/api/signmessage` (legacy)
- **Headers**: `Content-Type: application/json`
- **Body (JSON)**:

```json
{
  "message": "Hello, LND!"
}
```

- **Exemple curl**:

```bash
curl -X POST http://localhost:5003/api/signmessage \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello, LND!"}'
```

### 8) Verifier un message signe

- **Method**: `POST`
- **Route**: `/api/nodes/:nodeId/verifymessage` ou `/api/verifymessage` (legacy)
- **Headers**: `Content-Type: application/json`
- **Body (JSON)**:

```json
{
  "message": "Hello, LND!",
  "signature": "<signature>",
  "pubkey": "<public_key_hex>"
}
```

- Les 3 champs sont obligatoires.
- **Exemple curl**:

```bash
curl -X POST http://localhost:5003/api/verifymessage \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello, LND!","signature":"<signature>","pubkey":"<public_key_hex>"}'
```

## Erreurs courantes

- `404 Unknown LND node`: l'identifiant `:nodeId` ne correspond a aucun noeud connecte (consultez `GET /api/nodes`).
- `503 LND service is unavailable`: la connexion LND n'est pas etablie (variables `.env` invalides ou noeud injoignable).
- `400` sur les routes `POST`: payload JSON manquant ou invalide.
- `500 Failed to get channels`: erreur LND lors de l'appel `getChannels` (macaroon, certificat, ou noeud injoignable).
- `500`: erreur interne renvoyee par LND ou par le serveur.

## Scripts npm

- `npm start`: demarrage standard
- `npm run dev`: mode developpement avec `nodemon`
