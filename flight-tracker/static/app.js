// Configuration
const API_URL = 'https://opensky-network.org/api/states/all';
const REFRESH_INTERVAL = 10000; // 10 seconds

// Elements
const mapEl = document.getElementById('map');
const sidebar = document.getElementById('flight-sidebar');
const closeBtn = document.getElementById('close-sidebar');
const flightInfo = document.getElementById('flight-info');
const statusIndicator = document.getElementById('status-indicator');
const statusDot = document.querySelector('.status-dot');
const statusText = document.getElementById('status-text');

// Price Dashboard Elements
const priceDataContainer = document.getElementById('price-data');

// State
let map;
let markers = {}; // id -> Leaflet Marker
let selectedFlight = null;
let updateInterval;

// SVG for Plane Icon
const planeSVG = `
<svg viewBox="0 0 24 24" class="plane-icon" xmlns="http://www.w3.org/2000/svg">
  <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
</svg>
`;

function initMap() {
    // Initialize map centered on Europe (good OpenSky coverage)
    map = L.map('map', {
        zoomControl: false // We'll add it in a better position if needed, or leave it off for cleaner UI
    }).setView([48.8566, 2.3522], 6);

    // Dark carto db tiles
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);

    // Add zoom control to bottom right
    L.control.zoom({
        position: 'bottomright'
    }).addTo(map);

    // Handle map movement to fetch new data
    map.on('moveend', () => {
        fetchFlights();
    });

    // Close sidebar when clicking on map
    map.on('click', () => {
        closeSidebar();
    });

    closeBtn.addEventListener('click', closeSidebar);

    // Initial fetch
    fetchFlights();
    fetchFlightPrices(); // Fetch price data

    // Set intervals
    updateInterval = setInterval(fetchFlights, REFRESH_INTERVAL);
    setInterval(fetchFlightPrices, 600000); // Update price every 10 minutes
}

async function fetchFlightPrices() {
    try {
        const response = await fetch('http://localhost:5000/api/price');

        if (!response.ok) {
            throw new Error('Pricing API unavailable');
        }

        const data = await response.json();

        if (data.error) {
            priceDataContainer.innerHTML = `<div style="color: var(--danger-color); font-size: 0.85rem;">Error: ${data.error}</div>`;
            return;
        }

        const price = data.price;
        const airline = data.airline;
        const logo = data.airline_logo;
        const targetPrice = data.target_price;

        const isGoodPrice = price <= targetPrice;
        const priceClass = isGoodPrice ? "price-good" : "price-bad";
        const message = isGoodPrice ? "Below Target!" : "Above Target";

        priceDataContainer.innerHTML = `
            <div class="price-display">
                <span class="price-amount ${priceClass}">$${price}</span>
            </div>
            <div class="price-airline">
                ${logo ? `<img src="${logo}" alt="${airline} logo" crossorigin="anonymous">` : ''}
                <span>${airline}</span>
            </div>
            <div class="price-target-msg ${priceClass}">${message} (Target: $${targetPrice})</div>
        `;

    } catch (error) {
        console.error('Error fetching prices:', error);
        priceDataContainer.innerHTML = `<div style="color: var(--text-muted); font-size: 0.85rem;">Backend not running</div>`;
    }
}

function updateStatus(status, message) {
    statusDot.className = 'status-dot ' + status;
    statusText.textContent = message;
}

async function fetchFlights() {
    updateStatus('loading', 'Updating...');

    try {
        // Get current map bounds
        const bounds = map.getBounds();
        const lamin = bounds.getSouth();
        const lamax = bounds.getNorth();
        const lomin = bounds.getWest();
        const lomax = bounds.getEast();

        // API limits bounds to max area. For huge zoom outs, we might want to restrict this or not fetch.
        // Let's implement a simple check to avoid downloading the whole world.
        const area = (lamax - lamin) * (lomax - lomin);
        if (area > 1000) {
            updateStatus('error', 'Zoom in to view flights');
            return;
        }

        const url = `${API_URL}?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
        const response = await fetch(url);

        if (!response.ok) {
            if (response.status === 429) {
                throw new Error('Rate limit exceeded');
            }
            throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();
        updateMarkers(data.states || []);
        updateStatus('success', 'Live');

    } catch (error) {
        console.error('Fetch error:', error);
        updateStatus('error', error.message || 'Connection lost');
    }
}

function updateMarkers(states) {
    const activeIds = new Set();

    states.forEach(flight => {
        // OpenSky State Vector indices:
        // 0: icao24, 1: callsign, 2: origin_country, 3: time_position, 4: last_contact,
        // 5: longitude, 6: latitude, 7: baro_altitude, 8: on_ground, 9: velocity,
        // 10: true_track, 11: vertical_rate, 12: sensors, 13: geo_altitude, 14: squawk,
        // 15: spi, 16: position_source

        const id = flight[0];
        const callsign = flight[1] ? flight[1].trim() : 'Unknown';
        const country = flight[2];
        const lng = flight[5];
        const lat = flight[6];
        const altitude = flight[7]; // meters
        const velocity = flight[9]; // m/s
        const track = flight[10] || 0; // degrees

        // Skip invalid coordinates
        if (lat === null || lng === null) return;

        activeIds.add(id);

        const flightData = { id, callsign, country, lat, lng, altitude, velocity, track };

        if (markers[id]) {
            // Update existing marker
            markers[id].setLatLng([lat, lng]);
            const iconWrapper = markers[id].getElement()?.querySelector('.plane-icon-wrapper');
            if (iconWrapper) {
                iconWrapper.style.transform = `rotate(${track}deg)`;
            }
            markers[id].flightData = flightData;

            // Re-render sidebar if this flight is selected
            if (selectedFlight === id) {
                renderSidebar(flightData);
            }
        } else {
            // Create new marker
            const icon = L.divIcon({
                html: `<div class="plane-icon-wrapper" style="transform: rotate(${track}deg)">${planeSVG}</div>`,
                className: 'custom-leaflet-marker',
                iconSize: [24, 24],
                iconAnchor: [12, 12]
            });

            const marker = L.marker([lat, lng], { icon }).addTo(map);
            marker.flightData = flightData;

            marker.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                selectFlight(id);
            });

            markers[id] = marker;
        }
    });

    // Remove stale markers
    Object.keys(markers).forEach(id => {
        if (!activeIds.has(id)) {
            map.removeLayer(markers[id]);
            delete markers[id];

            // If selected flight disappeared, close sidebar
            if (selectedFlight === id) {
                closeSidebar();
            }
        }
    });
}

function selectFlight(id) {
    // Deselect previous
    if (selectedFlight && markers[selectedFlight]) {
        markers[selectedFlight].getElement().querySelector('.plane-icon').classList.remove('selected');
        markers[selectedFlight].setZIndexOffset(0);
    }

    selectedFlight = id;

    // Select new
    if (markers[id]) {
        markers[id].getElement().querySelector('.plane-icon').classList.add('selected');
        markers[id].setZIndexOffset(1000); // Bring to front
        renderSidebar(markers[id].flightData);
        openSidebar();
    }
}

function openSidebar() {
    sidebar.classList.remove('hidden');
}

function closeSidebar() {
    sidebar.classList.add('hidden');
    // Deselect marker styling
    if (selectedFlight && markers[selectedFlight]) {
        const el = markers[selectedFlight].getElement();
        if (el) {
            const icon = el.querySelector('.plane-icon');
            if (icon) icon.classList.remove('selected');
        }
    }
    selectedFlight = null;
}

function renderSidebar(data) {
    // Convert units
    const altFeet = data.altitude ? Math.round(data.altitude * 3.28084) : 'N/A';
    const speedKnots = data.velocity ? Math.round(data.velocity * 1.94384) : 'N/A';

    flightInfo.innerHTML = `
        <div class="data-grid">
            <div class="data-item">
                <div class="data-label">Callsign</div>
                <div class="data-value highlight">${data.callsign}</div>
            </div>
            <div class="data-item">
                <div class="data-label">Origin Country</div>
                <div class="data-value">${data.country}</div>
            </div>
            <div class="data-item">
                <div class="data-label">Altitude</div>
                <div class="data-value">${altFeet} ft</div>
            </div>
            <div class="data-item">
                <div class="data-label">Ground Speed</div>
                <div class="data-value">${speedKnots} kts</div>
            </div>
            <div class="data-item">
                <div class="data-label">Heading</div>
                <div class="data-value">${Math.round(data.track)}°</div>
            </div>
            <div class="data-item">
                <div class="data-label">ICAO24</div>
                <div class="data-value" style="font-family: monospace;">${data.id.toUpperCase()}</div>
            </div>
        </div>
    `;
}

// Start app
document.addEventListener('DOMContentLoaded', initMap);
