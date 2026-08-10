# 🚀 EOS Chatbot - Startup Guide

## Project Setup Status ✅

✅ Dependencies installed  
✅ Environment variables configured (.env created)  
✅ Prisma Client generated  
✅ TypeScript compiled  

---

## 📋 Prerequisites

Before running the project, ensure you have:

1. **Node.js** (v18+) and npm installed
2. **PostgreSQL** running locally on `localhost:5432`
3. **Database created** (default: `eos_db`)
4. **PostgreSQL credentials** (default in .env: username=`postgres`, password=`postgres`)

### Quick PostgreSQL Setup (Windows)

If you don't have PostgreSQL running:
```bash
# Using PostgreSQL with default settings:
# - Host: localhost
# - Port: 5432
# - Username: postgres
# - Password: postgres (or your configured password)
```

---

## 🏃 Running the Project

### Option 1: Development Mode (RECOMMENDED)
**With hot-reload and file watching:**

```bash
cd c:\PROJECTS\Pavakie_ERP_Chatbot\EOS-Chatbot\chatbot
npm run dev
```

This will:
- Start the server on `http://localhost:4000`
- Auto-reload on file changes
- Show real-time TypeScript errors

### Option 2: Production Mode
**Build and start the compiled version:**

```bash
cd c:\PROJECTS\Pavakie_ERP_Chatbot\EOS-Chatbot\chatbot
npm run build
npm start
```

This will:
- Build TypeScript to JavaScript in `dist/` folder
- Run the compiled server on `http://localhost:4000`

---

## 🗄️ Prisma Database Setup

### Generate Prisma Client
```bash
npm run prisma:generate
```

### View Database in Prisma Studio
```bash
npx prisma studio
```
This opens a GUI to browse and manage your database at `http://localhost:5555`

### Run Database Migrations (if needed)
```bash
npx prisma migrate deploy
```

---

## 📝 Configuration (.env)

Your `.env` file is located at:
```
c:\PROJECTS\Pavakie_ERP_Chatbot\EOS-Chatbot\chatbot\.env
```

**Current Settings:**
```
PORT=4000
NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/eos_db
CHATBOT_JWT_SECRET=your_secret_jwt_key_replace_this_with_a_long_random_string_12345
CHATBOT_JWT_EXPIRES_IN=8h
INTENT_CONFIDENCE_THRESHOLD=0.55
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173,http://localhost:4000
```

**To modify:**
Edit the `.env` file directly and restart the server.

---

## 🔍 Available npm Scripts

```bash
npm run dev              # Start development server with hot-reload
npm run build           # Build TypeScript to JavaScript
npm start               # Run compiled server
npm run prisma:generate # Generate Prisma Client
npm run train:parse     # Parse intent training dataset
npm run train:embed     # Build embeddings
npm run train           # Run all training (parse + embed)
npm run typecheck       # Check TypeScript types without building
```

---

## ✅ Verification Checklist

- [ ] PostgreSQL is running
- [ ] Database `eos_db` exists
- [ ] `.env` file is configured with correct DATABASE_URL
- [ ] Node dependencies are installed (`npm install` completed)
- [ ] Prisma Client is generated (`npm run prisma:generate` completed)

---

## 🎯 Quick Start Command

```bash
# Navigate to project directory
cd c:\PROJECTS\Pavakie_ERP_Chatbot\EOS-Chatbot\chatbot

# Start in development mode
npm run dev
```

The server will start at **http://localhost:4000**

---

## 🐛 Troubleshooting

### Error: "connect ECONNREFUSED 127.0.0.1:5432"
- PostgreSQL is not running
- **Fix:** Start PostgreSQL server

### Error: "database does not exist"
- The database specified in DATABASE_URL doesn't exist
- **Fix:** Create the database in PostgreSQL or update DATABASE_URL

### Error: "Cannot find module"
- Dependencies not installed
- **Fix:** Run `npm install`

### Error: "Prisma Client not found"
- Prisma Client not generated
- **Fix:** Run `npm run prisma:generate`

---

## 📚 Project Structure

```
chatbot/
├── src/
│   ├── server.ts              # Main server file
│   ├── app.ts                 # Express app configuration
│   ├── auth/                  # JWT authentication
│   ├── middleware/            # Express middleware
│   ├── routes/                # API routes
│   ├── services/              # Business logic & database queries
│   ├── intent/                # Intent detection logic
│   ├── embeddings/            # SBERT embeddings
│   ├── config/                # Configuration files
│   ├── training/              # Training scripts
│   ├── utils/                 # Utility functions
│   └── generated/             # Prisma Client (auto-generated)
├── prisma/
│   └── schema.prisma          # Prisma schema (database models)
├── dist/                      # Compiled JavaScript (generated on build)
├── package.json               # Dependencies and scripts
├── tsconfig.json              # TypeScript configuration
└── .env                       # Environment variables (local)
```

---

## 🔗 API Endpoints

Once the server is running, you can access:

- **Base URL:** `http://localhost:4000`
- **API Routes:** See `src/routes/` for available endpoints
- **Health Check:** `http://localhost:4000/health` (if configured)

---

## 📧 Support

For issues, check:
1. README.md - Project documentation
2. .env configuration - Database and server settings
3. Console output - Error messages during startup

---

**Created:** 2026-08-09  
**Updated:** 2026-08-09
