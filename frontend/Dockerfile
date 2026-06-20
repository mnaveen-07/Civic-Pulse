FROM node:22-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application
COPY . .

EXPOSE 5173

# Expose Vite on the network so it's accessible outside the container
CMD ["npm", "run", "dev", "--", "--host"]
