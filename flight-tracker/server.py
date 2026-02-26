from flask import Flask, jsonify, request, render_template
from flask_cors import CORS
import os
import requests
from dotenv import load_dotenv
import time

# Load environment variables
load_dotenv()

app = Flask(__name__, static_url_path='', static_folder='static', template_folder='templates')
CORS(app) # Allow CORS for the frontend to access this API

API_KEY = os.getenv("SERPAPI_KEY", "") 

# Optional caching to prevent hitting SerpApi on every single page load
# Realistically, this should use a proper cache layer or database for production
CACHE_DURATION = 3600 # 1 hour
cached_data = None
last_fetch_time = 0

def fetch_cheapest_flight(departure_id="DFW", arrival_id="SFO", outbound_date="2026-03-15", return_date="2026-03-22"):
    """Fetches flight prices using SerpApi Google Flights engine."""
    
    if not API_KEY or API_KEY == "your_api_key_here":
        # Fallback to mock data for demonstration purposes if no key is provided
        print("WARNING: No valid SERPAPI_KEY. Using mock data.")
        return {
            "price": 289,
            "airline": "Mock Airlines (No API Key)",
            "airline_logo": "",
            "departure": departure_id,
            "arrival": arrival_id,
            "target_price": 300,
            "booking_link": "https://www.google.com/flights"
        }, 200

    params = {
      "engine": "google_flights",
      "departure_id": departure_id,
      "arrival_id": arrival_id,
      "type": "2", # Round trip
      "outbound_date": outbound_date,
      "return_date": return_date,
      "currency": "USD",
      "hl": "en",
      "api_key": API_KEY
    }

    try:
        response = requests.get("https://serpapi.com/search.json", params=params)
        response.raise_for_status()
        data = response.json()
        
        if "error" in data:
            return {"error": data["error"]}, 400

        best_flights = data.get("best_flights", [])
        other_flights = data.get("other_flights", [])
        all_flights = best_flights + other_flights
        
        if not all_flights:
            return {"error": "No flights found for the given dates."}, 404

        # Find the absolute cheapest flight
        cheapest_flight = min(all_flights, key=lambda f: f.get("price", float('inf')))
        
        price = cheapest_flight.get("price")
        airline_logo = cheapest_flight.get("airline_logo", "")
        
        try:
            flight_segments = cheapest_flight.get("flights", [])
            airline = flight_segments[0].get("airline", "Unknown Airline")
        except IndexError:
            airline = "Unknown Airline"
            
        booking_link = data.get("search_metadata", {}).get("google_flights_url", "https://www.google.com/flights")

        return {
            "price": price,
            "airline": airline,
            "airline_logo": airline_logo,
            "departure": departure_id,
            "arrival": arrival_id,
            "target_price": 300, # Passed down so frontend knows what threshold to colorize
            "booking_link": booking_link
        }, 200

    except requests.exceptions.HTTPError as e:
        status_code = getattr(e, 'response', None)
        status_code = status_code.status_code if status_code else 500
        return {"error": f"API Request failed with status code {status_code}"}, status_code
    except Exception as e:
        return {"error": f"Server processing error: {str(e)}"}, 500


@app.route('/')
def index():
    """Serve the main frontend application."""
    return render_template('index.html')


@app.route('/api/price')
def get_price():
    global cached_data, last_fetch_time
    current_time = time.time()
    
    # Check cache
    if cached_data and (current_time - last_fetch_time) < CACHE_DURATION:
        print("Serving price from cache...")
        return jsonify(cached_data[0]), cached_data[1]

    # Allow frontend to override defaults via query parameters
    dep = request.args.get('departure_id', 'DFW')
    arr = request.args.get('arrival_id', 'SFO')
    outb = request.args.get('outbound_date', '2026-03-15')
    ret = request.args.get('return_date', '2026-03-22')

    print(f"Fetching fresh API data for {dep} to {arr}...")
    data, status = fetch_cheapest_flight(dep, arr, outb, ret)
    
    # Store in simple memory cache if successful
    if status == 200:
        cached_data = (data, status)
        last_fetch_time = current_time

    return jsonify(data), status


if __name__ == '__main__':
    print("Starting Flight Track & Price Backend on port 5000...")
    app.run(debug=True, port=5000)
