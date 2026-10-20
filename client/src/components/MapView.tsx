import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import { useEffect } from 'react';
import { Link } from 'react-router';

function Fit({ points }: { points: { lat: number; lng: number }[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 1) map.setView([points[0].lat, points[0].lng], 14);
    else if (points.length > 1) map.fitBounds(points.map((p) => [p.lat, p.lng]) as any, { padding: [30, 30] });
  }, [map, points]);
  return null;
}

export default function MapView({ points, height = '100%' }: { points: { lat: number; lng: number; label: string; href?: string }[]; height?: string }) {
  const center = points[0] ? [points[0].lat, points[0].lng] : [34.0, 71.6];
  return (
    <MapContainer center={center as any} zoom={8} style={{ height, width: '100%' }} scrollWheelZoom={false}>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Fit points={points} />
      {points.map((p, i) => (
        <CircleMarker key={i} center={[p.lat, p.lng]} radius={8} pathOptions={{ color: '#fff', weight: 2, fillColor: '#2a78d6', fillOpacity: 1 }}>
          <Popup>{p.href ? <Link to={p.href}>{p.label}</Link> : p.label}</Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
