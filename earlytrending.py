import re
import asyncio
from telethon import TelegramClient, events
from telethon.errors import SessionPasswordNeededError

# Define the API ID, API hash, and phone number for the Telegram client
api_id = ____
api_hash = 'api hash here'
phone_number = 'phone number'

# Define the source and destination chat IDs
source_chat_id = 
destination_chat_id = 

# Set to store seen contract addresses
seen_contract_addresses = set()

# Function to extract phrases from a message
def extract_phrases(message):
    # Extract text from message
    text = message.raw_text
    if re.search(r'#1|#2|#3', text) and '🚨' not in text:
        return True
    return False

# Function to extract liquidity percentage from message
def extract_liquidity_percentage(message_text):
    lines = message_text.split('\n')
    liquidity_line = next((line for line in lines if 'Liq' in line), None)
    if liquidity_line:
        try:
            liquidity_percentage = float(liquidity_line.split('(')[-1].split('%')[0])
            return liquidity_percentage
        except (ValueError, IndexError):
            pass
    return None

# Function to extract contract address from message
def extract_contract_address(message_text):
    match = re.search(r'[a-zA-Z0-9]{30,50}', message_text)
    if match:
        return match.group(0)
    return None

# Initialize the Telegram client
client = TelegramClient('session_name', api_id, api_hash)

@client.on(events.NewMessage(chats=source_chat_id))
async def handler(event):
    if extract_phrases(event.message):
        message_text = event.message.raw_text

        # Extract liquidity percentage from message
        liquidity_percentage = extract_liquidity_percentage(message_text)
        if liquidity_percentage is not None:
            if liquidity_percentage > 200.00 or liquidity_percentage < 5.00:
                print(f"Message not forwarded: liquidity percentage is {liquidity_percentage}%.")
                return

        # Extract contract address from message
        contract_address = extract_contract_address(message_text)

        if contract_address:
            if contract_address not in seen_contract_addresses:
                # Send only the contract address
                await client.send_message(destination_chat_id, contract_address)
                # Print the forwarded contract address
                print(f"Forwarded contract address: {contract_address}")
                # Add contract address to seen set
                seen_contract_addresses.add(contract_address)
            else:
                print(f"Ignored duplicate contract address: {contract_address}")
        else:
            print("No contract address found in message")

async def main():
    await client.start(phone_number)
    print("Client started")

    # Ensure you're logged in
    if not await client.is_user_authorized():
        try:
            await client.send_code_request(phone_number)
            await client.sign_in(phone_number, input('Enter the code: '))
        except SessionPasswordNeededError:
            await client.sign_in(password=input('Password: '))

    print("Client authorized")

    # Run the client until disconnected
    await client.run_until_disconnected()
    print("Client disconnected")

# Run the main function
loop = asyncio.get_event_loop()
loop.run_until_complete(main())
