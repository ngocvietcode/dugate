FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm install --omit=dev

# Copy source code
COPY . .

# Environment variables
ENV MOCK_PORT=3099
ENV MOCK_API_KEY=DUMMY_SECRET_KEY
ENV MOCK_DELAY_MS=300

# Expose port
EXPOSE 3099

# Start command
CMD ["node", "server.js"]
