'use client';

import { useEffect, useRef } from 'react';
import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
import type { ExternalUnit, RescueAsset, SearchArea } from '@/lib/types';

export function SearchMap({ areas, assets, externalUnits = [] }: { areas: SearchArea[]; assets: RescueAsset[]; externalUnits?: ExternalUnit[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);

  useEffect(() => {
    let disposed = false;
    void import('maplibre-gl').then(({ Map, Marker: MapMarker, LngLatBounds }) => {
      if (disposed || !containerRef.current) return;
      const map = new Map({ container: containerRef.current, center: [121.68, 30.82], zoom: 8.5, style: 'https://demotiles.maplibre.org/style.json' });
      mapRef.current = map;
      map.on('load', () => {
        areas.forEach((area) => {
          map.addSource(area.id, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[area.bounds[0], area.bounds[1]], [area.bounds[2], area.bounds[1]], [area.bounds[2], area.bounds[3]], [area.bounds[0], area.bounds[3]], [area.bounds[0], area.bounds[1]]]] } } });
          map.addLayer({ id: `${area.id}-fill`, type: 'fill', source: area.id, paint: { 'fill-color': area.status === 'active' ? '#0e7490' : '#f59e0b', 'fill-opacity': .22 } });
          map.fitBounds(new LngLatBounds([area.bounds[0], area.bounds[1]], [area.bounds[2], area.bounds[3]]), { padding: 60 });
        });
        markersRef.current = assets.map((asset) => new MapMarker({ color: asset.status === 'offline' ? '#dc2626' : '#0f766e' }).setLngLat([asset.lng, asset.lat]).addTo(map));
        // 外部单位用紫色菱形标记，撤回的用灰色
        externalUnits.forEach((unit, index) => {
          const el = document.createElement('div');
          el.className = 'external-marker';
          el.style.background = unit.status === 'withdrawn' ? '#94a3b8' : unit.status === 'busy' ? '#f59e0b' : '#7c3aed';
          el.title = unit.name;
          const marker = new MapMarker({ element: el })
            .setLngLat([121.5 + index * 0.12, 30.55 + (index % 2) * 0.1])
            .addTo(map);
          markersRef.current.push(marker);
        });
      });
    });
    return () => { disposed = true; markersRef.current.forEach((marker) => marker.remove()); mapRef.current?.remove(); };
  }, [areas, assets, externalUnits]);

  return <div ref={containerRef} className="map-shell" aria-label="搜救海域地图" />;
}
