#!/bin/bash
SERVER="user@YOUR_SERVER_IP"
REMOTE_PATH="/opt/qa-infinity"
LOCAL_PATH="/mnt/c/Users/albin/Sixdee telecom solutions pvt. ltd/AirtelAfrica-Ventas - Documents/Delivery/Automation/QA Infinity/qa-infinity"

rsync -avz --progress \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='dist' \
  --exclude='*.log' \
  "$LOCAL_PATH/" "$SERVER:$REMOTE_PATH/"

ssh $SERVER "cd $REMOTE_PATH && docker compose down && docker compose up --build -d"
