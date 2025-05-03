# kanbany-websocket

Secure WebSocket server powering Kanbany’s shared boards over HTTPS.

## Features

- WebSocket-based real-time communication for shared boards.
- Rate limiting for both HTTP and WebSocket requests.
- Secure database connection using PostgreSQL.

## Requirements

- Node.js (v16 or later)
- PostgreSQL database
- Environment variables:
  - `DATABASE_URL`: Connection string for your PostgreSQL database.
  - `PORT`: Port number for the server (default: 4000).

## Setup

1. Clone the repository
2. Install dependencies: npm install
3. chmod +x start.sh