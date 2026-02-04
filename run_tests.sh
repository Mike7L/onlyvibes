#!/bin/bash
# OnlyMusic Test Runner

echo "=== Starting OnlyMusic Test Suite ==="
echo

# 1. Node.js Provider Tests
echo "--- Running Node.js Provider Tests ---"
cd pwa && node tests/provider-tests.js
NODE_PROVIDER_STATUS=$?
cd ..

if [ $NODE_PROVIDER_STATUS -ne 0 ]; then
    echo "❌ Node.js Provider Tests FAILED"
    exit 1
fi
echo "✅ Node.js Provider Tests PASSED"
echo

# 2. Node.js API Integration Tests
echo "--- Running Node.js API Integration Tests ---"
cd pwa && node tests/api-tests.js
NODE_API_STATUS=$?
cd ..

if [ $NODE_API_STATUS -ne 0 ]; then
    echo "❌ Node.js API Integration Tests FAILED"
    exit 1
fi
echo "✅ Node.js API Integration Tests PASSED"
echo

# 3. Node.js ytdl-Independence Verification
echo "--- Running Node.js ytdl-Independence Verification ---"
cd pwa && node tests/no-ytdl-verify.js
NODE_YTDL_STATUS=$?
cd ..

if [ $NODE_YTDL_STATUS -ne 0 ]; then
    echo "❌ Node.js ytdl-Independence Verification FAILED"
    exit 1
fi
echo "✅ Node.js ytdl-Independence Verification PASSED"
echo

# 3. Python Streamer Feature Tests
echo "--- Running Python Streamer Feature Tests ---"
export PYTHONPATH=$PYTHONPATH:.
python3 tests/test_streamer_features.py
PY_STATUS=$?

if [ $PY_STATUS -ne 0 ]; then
    echo "❌ Python Streamer Tests FAILED"
    exit 1
fi
echo "✅ Python Streamer Tests PASSED"
echo

# 5. Python Streamer Fallback Tests
echo "--- Running Python Streamer Fallback Tests ---"
python3 pwa/tests/test_streamer_no_ytdl.py
PY_FALLBACK_STATUS=$?

if [ $PY_FALLBACK_STATUS -ne 0 ]; then
    echo "❌ Python Streamer Fallback Tests FAILED"
    exit 1
fi
echo "✅ Python Streamer Fallback Tests PASSED"
echo

echo "🎉 ALL TESTS PASSED SUCCESSFULLY 🎉"
