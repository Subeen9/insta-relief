import { useEffect, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, Popup } from "react-leaflet";

export default function NoaaMap() {
  const [alertZones, setAlertZones] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch active NOAA alerts + their polygons
  const fetchNoaaAlerts = async () => {
    try {
      const res = await fetch("https://api.weather.gov/alerts/active");
      const data = await res.json();

      const fetchedGeo = [];

      for (const alert of data.features) {
        const zoneUrls = alert.properties.affectedZones;

        for (const zoneUrl of zoneUrls) {
          const zoneRes = await fetch(zoneUrl);
          const zoneData = await zoneRes.json();

          if (zoneData.geometry) {
            fetchedGeo.push({
              alertTitle: alert.properties.event,
              alertArea: alert.properties.areaDesc,
              severity: alert.properties.severity,
              description: alert.properties.description,
              geometry: zoneData.geometry,
            });
          }
        }
      }

      setAlertZones(fetchedGeo);
    } catch (err) {
      console.error("NOAA error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNoaaAlerts();
  }, []);

  return (
    <div style={{ height: "600px", width: "100%" }}>
      {loading ? (
        <p>Loading NOAA Alerts...</p>
      ) : (
        <MapContainer
          center={[39.5, -98.35]} // USA center
          zoom={5}
          scrollWheelZoom={true}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution='&copy; OpenStreetMap'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {alertZones.map((zone, idx) => (
            <GeoJSON
              key={idx}
              data={zone.geometry}
              style={{
                color: "red",
                weight: 2,
                fillOpacity: 0.25,
              }}
            >
              <Popup>
                <strong>{zone.alertTitle}</strong>
                <br />
                <strong>Area:</strong> {zone.alertArea}
                <br />
                <strong>Severity:</strong> {zone.severity}
                <br />
                <p>{zone.description?.slice(0, 200)}...</p>
              </Popup>
            </GeoJSON>
          ))}
        </MapContainer>
      )}
    </div>
  );
}
