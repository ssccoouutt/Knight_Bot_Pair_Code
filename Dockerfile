FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (no lockfile needed!)
RUN npm install

# Copy rest of the code
COPY . .

# Expose port (adjust if your app uses different port)
EXPOSE 3000

# Start the app
CMD ["npm", "start"]
