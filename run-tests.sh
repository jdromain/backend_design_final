#!/bin/bash

# Run All Tests Script

echo "🧪 Running Rezovo Test Suite"
echo ""

# Check if backend is running
if ! lsof -i:3001 > /dev/null 2>&1; then
  echo "⚠️  Backend not running on port 3001"
  echo "   Starting backend..."
  cd apps/platform-api
  node dist/index.js &
  BACKEND_PID=$!
  cd ../..
  sleep 3
  echo "   ✅ Backend started (PID: $BACKEND_PID)"
  CLEANUP_BACKEND=true
else
  echo "✅ Backend already running on port 3001"
  CLEANUP_BACKEND=false
fi

echo ""

# Install test dependencies if needed
cd frontend
if [ ! -d "node_modules/@testing-library" ]; then
  echo "📦 Installing test dependencies..."
  pnpm add -D @testing-library/react @testing-library/jest-dom @testing-library/user-event @vitejs/plugin-react jsdom vitest @vitest/ui
  echo ""
fi

# Run tests
echo "🧪 Running Unit Tests..."
pnpm vitest run --reporter=verbose

TEST_EXIT_CODE=$?

cd ..

# Cleanup if we started backend
if [ "$CLEANUP_BACKEND" = true ]; then
  echo ""
  echo "🧹 Cleaning up backend..."
  kill $BACKEND_PID 2>/dev/null
fi

echo ""
if [ $TEST_EXIT_CODE -eq 0 ]; then
  echo "✅ All tests passed!"
  exit 0
else
  echo "❌ Some tests failed"
  exit 1
fi




