#!/bin/bash

# Rezovo Frontend Quick Start Script

echo "🚀 Starting Rezovo Frontend Development Environment"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm install
  echo ""
fi

# Check if .env.local exists
if [ ! -f ".env.local" ]; then
  echo "⚠️  Warning: .env.local not found"
  echo "Creating .env.local with default values..."
  cat > .env.local << 'EOF'
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
EOF
  echo "✅ Created .env.local"
  echo ""
fi

echo "📋 Quick Start Guide:"
echo ""
echo "1. Ensure backend is running on http://localhost:3001"
echo "2. Login with:"
echo "   Email: admin@example.com"
echo "   Password: password"
echo ""
echo "3. Available pages:"
echo "   - Dashboard: http://localhost:3000"
echo "   - Live Calls: http://localhost:3000/live"
echo "   - Call History: http://localhost:3000/history"
echo "   - Analytics: http://localhost:3000/analytics"
echo "   - AI Agents: http://localhost:3000/agents"
echo "   - Knowledge Base: http://localhost:3000/knowledge"
echo "   - Integrations: http://localhost:3000/integrations"
echo "   - Billing: http://localhost:3000/billing"
echo ""
echo "🌐 Starting development server..."
echo ""

npm run dev

