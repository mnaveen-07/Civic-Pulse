FROM node:18-bookworm

WORKDIR /app

# Install Python and pip for the machine learning scripts
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python-is-python3 \
    && rm -rf /var/lib/apt/lists/*

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy Python requirements and install
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt --break-system-packages

# Copy the rest of the application
COPY . .

# Ensure uploads directory exists
RUN mkdir -p uploads

EXPOSE 5000

CMD ["npm", "start"]
