FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build TypeScript (if needed for production)
RUN npm run build 2>/dev/null || true

# Expose the port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
