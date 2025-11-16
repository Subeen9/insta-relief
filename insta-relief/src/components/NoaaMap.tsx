import { useEffect, useState } from "react";
import {
  MapContainer,
  TileLayer,
  GeoJSON,
  Popup,
} from "react-leaflet";
// removed external 'geojson' import that's missing in your deps
// import { GeoJsonObject } from "geojson";
import "leaflet/dist/leaflet.css";

// minimal local GeoJSON type to avoid missing @types/geojson dependency
type GeoJsonObject = Record<string, unknown>;

interface AlertZone {
  alertTitle: string;
  alertArea: string;
  severity: string;
  description?: string;
  geometry: GeoJsonObject;
}

// minimal typing for NOAA feature shapes we use
type NoaaFeature = {
  properties: {
    affectedZones?: string[];
    event?: string;
    areaDesc?: string;
    severity?: string;
    description?: string;
  };
};

export default function NoaaMap() {
  const [alertZones, setAlertZones] = useState<AlertZone[]>([]);
  const [loading, setLoading] = useState(true);

  const MAX_ALERTS = 15;

  const fetchNoaaAlerts = async () => {
    try {
      const res = await fetch("https://api.weather.gov/alerts/active");
      const data = (await res.json()) as { features?: NoaaFeature[] };

      const limitedAlerts = (data.features ?? []).slice(0, MAX_ALERTS);

      const fetchedZones: AlertZone[] = [];
      const zoneRequests: Promise<Record<string, unknown>>[] = [];

      // build requests
      limitedAlerts.forEach((a) => {
        const urls = a.properties?.affectedZones ?? [];
        urls.forEach((url) => {
          zoneRequests.push(fetch(url).then((r) => r.json() as Promise<Record<string, unknown>>));
        });
      });

      const zoneResults = await Promise.all(zoneRequests);

      let index = 0;

      for (const alert of limitedAlerts) {
        const { event, areaDesc, severity, description } = alert.properties ?? {};

        const urls = alert.properties?.affectedZones ?? [];
        for (let z = 0; z < urls.length; z++) {
          const zoneUrl = urls[z]; // used for debug below
          const zoneData = zoneResults[index++];
          // optional debug reference to avoid "declared but never used"
          if (process.env.NODE_ENV === "development") {
            // eslint-disable-next-line no-console
            console.debug("NOAA zone:", zoneUrl);
          }

          const geometry = zoneData?.geometry as GeoJsonObject | undefined;
          if (geometry) {
            fetchedZones.push({
              alertTitle: event ?? "Unknown",
              alertArea: areaDesc ?? "Unknown",
              severity: severity ?? "Unknown",
              description,
              geometry,
            });
          }
        }
      }

      setAlertZones(fetchedZones);
    } catch (err) {
      console.error("NOAA error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNoaaAlerts();
  }, []);

  // cast props as any to avoid react-leaflet type mismatch in your environment
  const mapProps = {
    center: [39.5, -98.35],
    zoom: 5,
    scrollWheelZoom: true,
    style: { height: "100%", width: "100%" },
  } as any;

  const tileLayerProps = {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors",
  } as any;

  const geoJsonStyle = () =>
    ({
      color: "red",
      weight: 2,
      fillOpacity: 0.25,
    } as any);

  return (
    <div style={{ height: "600px", width: "100%" }}>
      {loading ? (
        <p>Loading NOAA Alerts...</p>
      ) : (
        <MapContainer {...mapProps}>
          <TileLayer {...tileLayerProps} />

          {alertZones.map((zone, idx) => (
            // cast GeoJSON component props to any to avoid style typing mismatch
            <GeoJSON
              key={idx}
              data={zone.geometry as any}
              {...({ style: geoJsonStyle } as any)}
            >
              <Popup>
                <strong>{zone.alertTitle}</strong>
                <br />
                <strong>Area:</strong> {zone.alertArea}
                <br />
                <strong>Severity:</strong> {zone.severity}
                <p>{zone.description?.slice(0, 200)}...</p>
              </Popup>
            </GeoJSON>
          ))}
        </MapContainer>
      )}
    </div>
  );
}