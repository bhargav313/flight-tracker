import os
import time
import requests
from dotenv import load_dotenv
from plyer import notification

# Load environment variables from .env file
load_dotenv()

# Configuration
# ==========================================
# Get a free API key at https://serpapi.com/
API_KEY = os.getenv("SERPAPI_KEY", "") 
DEPARTURE_AIRPORT = "DFW"
ARRIVAL_AIRPORT = "SFO"
# Format: YYYY-MM-DD. Set to None to look for "anytime in the next month"
OUTBOUND_DATE = "2026-03-15" 
RETURN_DATE = "2026-03-22"
TARGET_PRICE = 300 # Notify if price drops below this USD amount

# Check interval in seconds (e.g., 3600 = 1 hour)
CHECK_INTERVAL_SECONDS = 3600 
# ==========================================

def fetch_cheapest_flight():
    """Fetches flight prices using SerpApi Google Flights engine."""
    
    if not API_KEY:
        print("Error: SERPAPI_KEY is not set. Please add it to your .env file.")
        return None

    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Checking prices for {DEPARTURE_AIRPORT} to {ARRIVAL_AIRPORT}...")
    
    params = {
      "engine": "google_flights",
      "departure_id": DEPARTURE_AIRPORT,
      "arrival_id": ARRIVAL_AIRPORT,
      "type": "2", # Round trip
      "outbound_date": OUTBOUND_DATE,
      "return_date": RETURN_DATE,
      "currency": "USD",
      "hl": "en",
      "api_key": API_KEY,
      # Optional: "stops": "1" for direct flights only
    }

    try:
        response = requests.get("https://serpapi.com/search.json", params=params)
        response.raise_for_status()
        data = response.json()
        
        # Best flights are generally highlighted by Google
        best_flights = data.get("best_flights", [])
        other_flights = data.get("other_flights", [])
        
        all_flights = best_flights + other_flights
        
        if not all_flights:
            print("No flights found for the given dates.")
            return None

        # Find the absolute cheapest flight
        cheapest_flight = min(all_flights, key=lambda f: f.get("price", float('inf')))
        return cheapest_flight

    except Exception as e:
        print(f"An error occurred while fetching flights: {e}")
        return None

def notify_price_drop(price, airline):
    """Triggers a Windows desktop notification."""
    title = f"Flight Price Alert! ${price}"
    message = f"Cheapest flight from {DEPARTURE_AIRPORT} to {ARRIVAL_AIRPORT} is now ${price} on {airline}."
    print(f"TRIGGERING NOTIFICATION: {title} - {message}")
    
    try:
        notification.notify(
            title=title,
            message=message,
            app_name='Flight Tracker',
            timeout=10 # seconds
        )
    except Exception as e:
        print(f"Failed to send Windows notification: {e}")


def main():
    print(f"Starting flight price tracker: {DEPARTURE_AIRPORT} -> {ARRIVAL_AIRPORT}")
    print(f"Target Price: ${TARGET_PRICE}")
    print(f"Checking every {CHECK_INTERVAL_SECONDS / 60} minutes.")
    print("-" * 40)
    
    # Test notification on startup
    notification.notify(
        title="Flight Tracker Started",
        message=f"Monitoring {DEPARTURE_AIRPORT} to {ARRIVAL_AIRPORT}. Target: ${TARGET_PRICE}",
        app_icon=None,
        timeout=5,
    )
    
    while True:
        cheapest_flight = fetch_cheapest_flight()
        
        if cheapest_flight:
            price = cheapest_flight.get("price")
            airline_logo = cheapest_flight.get("airline_logo", "Unknown")
            
            # Flights might have multiple segments with different airlines.
            # Usually SerpApi returns an array of flights for the round trip.
            # We'll extract the airline name from the first flight segment.
            try:
                flight_segments = cheapest_flight.get("flights", [])
                airline = flight_segments[0].get("airline", "Unknown Airline")
            except IndexError:
                 airline = "Unknown Airline"

            print(f"Current lowest price: ${price} ({airline})")

            if price and price <= TARGET_PRICE:
                notify_price_drop(price, airline)
            else:
                 print(f"Price is still above target of ${TARGET_PRICE}.")
        
        print(f"Sleeping for {CHECK_INTERVAL_SECONDS} seconds...")
        time.sleep(CHECK_INTERVAL_SECONDS)

if __name__ == "__main__":
    # If run directly (not imported), begin the tracking loop
    main()
