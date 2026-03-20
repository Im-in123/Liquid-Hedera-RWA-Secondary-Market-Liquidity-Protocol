#!/bin/bash

# Liquid Hedera - Project Zip Script
# This creates a clean zip for hackathon submission

PROJECT_NAME="liquid-hedera-submission"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
ZIP_NAME="${PROJECT_NAME}_${TIMESTAMP}.zip"

echo "🚀 Creating hackathon submission zip..."
echo "📦 Zip file: $ZIP_NAME"
echo ""

# Create zip excluding unnecessary files
zip -r "$ZIP_NAME" . \
  -x "node_modules/*" \
  -x "*/node_modules/*" \
  -x "**/node_modules/*" \
  -x "cache/*" \
  -x "*/cache/*" \
  -x ".git/*" \
  -x "*/.git/*" \
  -x "artifacts/*" \
  -x "*/artifacts/*" \
  -x "dist/*" \
  -x "*/dist/*" \
  -x "build/*" \
  -x "*/build/*" \
  -x ".next/*" \
  -x "*/.next/*" \
  -x "coverage/*" \
  -x ".env" \
  -x ".env.local" \
  -x "*.log" \
  -x ".DS_Store" \
  -x "*.swp" \
  -x "*.swo" \
  -x "*~" \
  -x "package-lock.json" \
  -x "yarn.lock" \
  -x ".vscode/*" \
  -x ".idea/*"

echo ""
echo "✅ Zip created successfully!"
echo "📊 File size:"
ls -lh "$ZIP_NAME"
echo ""
echo "📂 Location: $(pwd)/$ZIP_NAME"
echo ""
echo "✨ Ready to submit!"
