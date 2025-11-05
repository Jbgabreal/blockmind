# Blockmind - AI-Powered Code Generation Platform

Blockmind is a next-generation AI-powered development platform that enables users to generate, modify, and deploy full-stack applications using natural language prompts. Built for the Solana ecosystem, it combines Claude Code's advanced AI capabilities with Daytona sandbox environments to provide a seamless code generation experience.

## 🚀 Features

### Core Functionality

- **AI-Powered Code Generation**: Generate complete applications from natural language prompts using Claude Code
- **Real-Time Code Preview**: Live preview of generated applications in isolated Daytona sandboxes
- **Project Management**: Create, save, and manage multiple projects with persistent chat history
- **Code Editor & Explorer**: View, search, and edit code directly in the browser with syntax highlighting
- **File Tracking**: Real-time visualization of files being written/modified during generation
- **Auto-Healing**: Automatic error detection and fixing for build issues
- **Multi-Project Support**: Create multiple projects within shared sandbox environments
- **Port Management**: Automatic port allocation (3000-3999) for concurrent project development

### Authentication & User Management

- **Web3 Authentication**: Privy integration for seamless user authentication
- **Solana Wallet Integration**: Automatic wallet generation on signup
- **Wallet Import/Export**: Users can import existing wallets or export their generated wallets
- **User Profiles**: Persistent user data with project associations

### Payment & Billing System

- **Crypto Payments**: Support for SOL, USDC, USDT, and custom Blockmind tokens
- **Payment Processing**: Helius webhook integration for real-time payment detection
- **Deposit Wallets**: Unique deposit wallets per user for secure payment handling
- **Credit System**: Track user credits and payment balances
- **Free Tier**: 3 free projects per user before payment requirement
- **Dynamic Pricing**: SOL price fetched from Binance API
- **Token Discounts**: Discounts for Blockmind token holders

### Developer Experience

- **Live Server Management**: Automatic server restart and PM2 process management
- **Build Error Detection**: Comprehensive error detection with auto-fix suggestions
- **Server Logs**: Real-time server logs and error tracking
- **Code Search**: Full-text search across the codebase
- **File Operations**: Create, edit, and save files directly from the browser
- **Turbopack Support**: Optimized for Next.js 16 with Turbopack

## 🛠️ Tech Stack

### Frontend
- **Next.js 14.2.3** - React framework with App Router
- **TypeScript** - Type-safe development
- **Tailwind CSS** - Utility-first CSS framework
- **React** - UI library

### Backend & Services
- **Supabase** - PostgreSQL database, authentication, and storage
- **Privy** - Web3 authentication and wallet management
- **Daytona SDK** - Sandbox environment management
- **Anthropic Claude Code** - AI code generation
- **Helius** - Solana blockchain data and webhooks
- **Solana Web3.js** - Solana blockchain interaction

### Infrastructure
- **Doppler** - Environment variable management
- **PM2** - Process management in sandboxes
- **Next.js Turbopack** - Fast bundler and dev server

## 📋 Prerequisites

- Node.js 18+ and npm
- Doppler CLI installed and configured
- Supabase project created
- Anthropic API key
- Daytona API key
- Privy app configured
- Helius API key (for payments)

## 🚀 Getting Started

### 1. Clone the Repository

```bash
git clone <repository-url>
cd blockmind
```

### 2. Install Doppler CLI

```bash
# Windows (PowerShell)
scoop install doppler
# or download from https://docs.doppler.com/docs/install-cli

# macOS
brew install doppler

# Linux
curl -L --request GET "https://cli.doppler.com/install.sh" | sh
```

### 3. Configure Doppler

```bash
# Login to Doppler
doppler login

# Create or link project
doppler setup

# Set all required environment variables (see DOPPLER_ENV_VARS.md)
```

### 4. Install Dependencies

```bash
cd blockmind-ui
npm install
```

### 5. Run Development Server

```bash
npm run dev
```

The application will be available at `http://localhost:3000`

## 🔧 Environment Variables

All environment variables are managed through Doppler. See `blockmind-ui/DOPPLER_ENV_VARS.md` for complete setup instructions.

### Required Variables

- **Supabase**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- **Anthropic**: `ANTHROPIC_API_KEY`
- **Daytona**: `DAYTONA_API_KEY`
- **Privy**: `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET`
- **Solana**: `SOLANA_CLUSTER`, `SOLANA_MAINNET_RPC`, `SOLANA_DEVNET_RPC`
- **Helius**: `HELIUS_API_KEY`, `HELIUS_WEBHOOK_ID`, `HELIUS_WEBHOOK_SECRET`, `HELIUS_WEBHOOK_URL`
- **Security**: `ENCRYPTION_KEY`, `ADMIN_API_KEY`

## 📁 Project Structure

```
blockmind/
├── blockmind-ui/
│   ├── app/
│   │   ├── api/              # API routes
│   │   │   ├── admin/        # Admin endpoints
│   │   │   ├── auth/         # Authentication
│   │   │   ├── generate-daytona/  # Code generation
│   │   │   ├── payments/     # Payment processing
│   │   │   ├── projects/     # Project management
│   │   │   └── ...
│   │   ├── generate/         # Generation page
│   │   └── page.tsx         # Dashboard
│   ├── components/           # React components
│   ├── lib/                  # Utility libraries
│   ├── scripts/              # Development scripts
│   └── utils/                # Helper utilities
```

## 🗄️ Database Schema

### Core Tables

- **`app_users`**: User accounts with wallet information
- **`projects`**: Project metadata and configuration
- **`sandboxes`**: Daytona sandbox information
- **`user_sandboxes`**: User-sandbox associations
- **`project_messages`**: Chat history per project
- **`user_token_balances`**: User payment balances
- **`payment_intents`**: Payment transaction tracking

See `blockmind-ui/SUPABASE_TABLES_AUDIT.md` for complete schema documentation.

## 🔌 API Endpoints

### Project Management
- `GET /api/projects` - List user projects
- `POST /api/projects` - Create new project
- `GET /api/projects/[sandboxId]` - Get project details
- `PUT /api/projects/[sandboxId]` - Update project
- `DELETE /api/projects/[sandboxId]` - Delete project
- `POST /api/projects/allocate` - Allocate project path and port

### Code Generation
- `POST /api/generate-daytona` - Generate code in Daytona sandbox (SSE stream)
- `GET /api/get-preview-url` - Get preview URL for project
- `POST /api/restart-server` - Restart dev server in sandbox

### File Operations
- `GET /api/explore-sandbox` - Get file tree
- `POST /api/view-file` - View file content
- `POST /api/save-file` - Save file changes
- `POST /api/search-sandbox` - Search codebase

### Payments
- `GET /api/payments/balance` - Get user balance
- `POST /api/payments/create-intent` - Create payment intent
- `POST /api/payments/verify` - Verify payment
- `POST /api/payments/helius-webhook` - Helius webhook handler
- `POST /api/payments/ensure-deposit-wallet` - Ensure deposit wallet exists

### Wallet Management
- `POST /api/wallet/import` - Import wallet via private key
- `GET /api/wallet/export` - Export user wallet private key

### Admin
- `GET /api/admin/get-private-key` - Get encrypted private key (admin only)
- `POST /api/admin/sync-helius-webhook` - Sync Helius webhook
- `POST /api/admin/fix-user-projects` - Fix user project associations

## 🎯 Key Workflows

### Creating a New Project

1. User logs in via Privy authentication
2. User enters a prompt describing the application
3. System creates/assigns a Daytona sandbox
4. Claude Code generates the application in the sandbox
5. Dev server starts automatically on allocated port
6. Preview becomes available in the UI
7. Project is saved to database with chat history

### Code Modification

1. User sends a follow-up prompt
2. System reuses existing sandbox
3. Claude Code modifies the application
4. Server automatically restarts if needed
5. Preview updates with changes
6. Chat history is persisted

### Payment Flow

1. User creates a project (3 free projects allowed)
2. System checks if payment is required
3. User is redirected to payment page
4. User sends crypto to their deposit wallet
5. Helius webhook detects payment
6. Payment is verified and credited
7. User can create more projects

## 🔒 Security Features

- **Encrypted Private Keys**: AES-256-GCM encryption for wallet private keys
- **Row Level Security**: Supabase RLS policies for data access
- **Admin API Keys**: Secure admin endpoints with API key authentication
- **Webhook Verification**: Helius webhook signature verification
- **Environment Variables**: All secrets managed through Doppler

## 🐛 Troubleshooting

### Common Issues

1. **Preview Not Loading**
   - Check if server is running: `pm2 list` in sandbox
   - Verify port is correct in database
   - Check server logs via Code tab → View Logs

2. **Build Errors**
   - System auto-detects and attempts to fix
   - Check Turbopack CSS issues (auto-fixed)
   - Review server logs for specific errors

3. **Port Conflicts**
   - System automatically reassigns ports
   - PM2 handles process management
   - Aggressive cleanup on restart

4. **Payment Not Detected**
   - Verify Helius webhook is configured
   - Check webhook URL is publicly accessible
   - Verify webhook secret matches

## 📚 Additional Documentation

- **Environment Variables**: `blockmind-ui/DOPPLER_ENV_VARS.md`
- **Database Schema**: `blockmind-ui/SUPABASE_TABLES_AUDIT.md`
- **Helius Setup**: `blockmind-ui/HELIUS_WEBHOOK_SETUP.md`
- **Admin API**: `blockmind-ui/ADMIN_API.md`

## 🚧 Development Scripts

### Available Scripts

```bash
# Development
npm run dev          # Start dev server with Doppler
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint

# Windows-specific
npm run install:win  # Install without native scripts
```

### Utility Scripts (in `scripts/`)

- `generate-in-daytona.ts` - Main code generation script
- `diagnose-sandbox.ts` - Diagnose sandbox issues
- `fix-turbopack-issue.ts` - Fix Turbopack CSS issues
- `test-daytona-connection.ts` - Test Daytona connectivity

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📝 License

[Add your license here]

## 🙏 Acknowledgments

- **Anthropic** - Claude Code API
- **Daytona** - Sandbox infrastructure
- **Privy** - Web3 authentication
- **Supabase** - Backend services
- **Helius** - Solana blockchain data

---

**Built with ❤️ for the Solana ecosystem**

For support, please open an issue or contact the development team.
