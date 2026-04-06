import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  AreaChart,
  Area,
  Cell,
} from "recharts";



const WS_URL = "wss://coldchain-live-backend-e3a4hnfycqdjh8bf.northeurope-01.azurewebsites.net";
const TEMP_LIMIT = 8;
const MAX_FEED = 30;
const MAX_HISTORY = 20;

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return ts;
  }
}

function classifyRisk(truck) {
  if (!truck) return "normal";
  if (truck.temperature_c > TEMP_LIMIT && truck.door_status === "open") return "critical";
  if (truck.temperature_c > TEMP_LIMIT) return "critical";
  if (truck.delay_minutes > 30 || truck.door_status === "open") return "warning";
  if (truck.journey_status === "Journey Completed") return "completed";
  return "normal";
}

function riskColor(risk) {
  switch (risk) {
    case "critical":
      return "#ef4444";
    case "warning":
      return "#f59e0b";
    case "completed":
      return "#22c55e";
    default:
      return "#38bdf8";
  }
}

function riskLabel(risk) {
  switch (risk) {
    case "critical":
      return "Critical";
    case "warning":
      return "Warning";
    case "completed":
      return "Completed";
    default:
      return "Normal";
  }
}

function StatCard({ label, value, color, subtitle }) {
  return (
    <div
      style={{
        background: "linear-gradient(180deg, rgba(17,24,39,1) 0%, rgba(15,23,42,1) 100%)",
        border: "1px solid #334155",
        borderRadius: 18,
        padding: 18,
        boxShadow: "0 18px 40px rgba(0,0,0,.25)",
      }}
    >
      <div style={{ color: "#94a3b8", fontSize: 14, marginBottom: 10 }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 700, color }}>{value}</div>
      <div style={{ color: "#64748b", fontSize: 12, marginTop: 8 }}>{subtitle}</div>
    </div>
  );
}

function MetricBox({ title, value, color = "#ffffff" }) {
  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,.08)",
        background: "rgba(255,255,255,.03)",
        borderRadius: 14,
        padding: 14,
      }}
    >
      <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

export default function App() {
  const [connected, setConnected] = useState(false);
  const [latestByTruck, setLatestByTruck] = useState({});
  const [feed, setFeed] = useState([]);
  const [search, setSearch] = useState("");
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const pulsePhaseRef = useRef(0);


  // create map once

  useEffect(() => {
  console.log("CONNECTING TO WS:", WS_URL);

  const ws = new WebSocket(WS_URL);

  ws.onopen = () => console.log("WebSocket connected");
  ws.onclose = () => console.log("WebSocket disconnected");
  ws.onerror = (err) => console.log("WebSocket error", err);

  ws.onmessage = (event) => {
    console.log("DATA RECEIVED:", event.data);
  };

  return () => {
    ws.close();
  };
}, []);









  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      center: [20, 0],
      zoom: 2,
      worldCopyJump: true,
      zoomControl: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // websocket live stream
  useEffect(() => {
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const risk = classifyRisk(data);

        setLatestByTruck((prev) => {
          const existing = prev[data.truck_id];
          const nextHistory = [
            ...(existing?.history || []),
            { t: formatTime(data.event_time), temp: data.temperature_c },
          ].slice(-MAX_HISTORY);

          return {
            ...prev,
            [data.truck_id]: {
              ...data,
              risk,
              history: nextHistory,
            },
          };
        });

        setFeed((prev) => [
          {
            ...data,
            risk,
            id: `${data.truck_id}-${data.event_time}`,
          },
          ...prev,
        ].slice(0, MAX_FEED));
      } catch (err) {
        console.error("Bad message", err);
      }
    };

    return () => ws.close();
  }, []);

  const trucks = useMemo(() => {
    const q = search.trim().toLowerCase();

    return Object.values(latestByTruck)
      .sort((a, b) => b.temperature_c - a.temperature_c)
      .filter((truck) => {
        if (!q) return true;
        return [truck.truck_id, truck.route_name, truck.region, truck.journey_status]
          .join(" ")
          .toLowerCase()
          .includes(q);
      });
  }, [latestByTruck, search]);

  const highestRiskTruck = trucks[0] || null;

  const metrics = useMemo(() => {
    const all = Object.values(latestByTruck);
    return {
      active: all.length,
      critical: all.filter((t) => classifyRisk(t) === "critical").length,
      warning: all.filter((t) => classifyRisk(t) === "warning").length,
      completed: all.filter((t) => t.journey_status === "Journey Completed").length,
    };
  }, [latestByTruck]);

  const rankingData = useMemo(() => {
    return trucks.slice(0, 8).map((truck) => ({
      truck_id: truck.truck_id,
      temperature_c: truck.temperature_c,
      risk: classifyRisk(truck),
    }));
  }, [trucks]);

  // sync markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    for (const truck of trucks) {
      if (
        typeof truck.lat !== "number" ||
        typeof truck.lon !== "number" ||
        Number.isNaN(truck.lat) ||
        Number.isNaN(truck.lon)
      ) {
        continue;
      }

      const risk = classifyRisk(truck);
      const color = riskColor(risk);

      const popupHtml = `
        <div style="font-size:14px;line-height:1.5;min-width:190px">
          <strong>${truck.truck_id}</strong><br/>
          Route: ${truck.route_name}<br/>
          Temp: ${truck.temperature_c}°C<br/>
          Status: ${truck.journey_status}<br/>
          Door: ${truck.door_status}<br/>
          Delay: ${truck.delay_minutes}m<br/>
          Region: ${truck.region || "-"}
        </div>
      `;

      if (markersRef.current[truck.truck_id]) {
        markersRef.current[truck.truck_id]
          .setLatLng([truck.lat, truck.lon])
          .setStyle({
            color,
            fillColor: color,
            fillOpacity: 0.8,
            weight: 2,
          })
          .bindPopup(popupHtml);
      } else {
        markersRef.current[truck.truck_id] = L.circleMarker([truck.lat, truck.lon], {
          radius: risk === "critical" ? 10 : 8,
          color,
          fillColor: color,
          fillOpacity: 0.8,
          weight: 2,
        })
          .addTo(map)
          .bindPopup(popupHtml);
      }
    }
  }, [trucks]);

  // pulse critical markers
  useEffect(() => {
    const interval = setInterval(() => {
      pulsePhaseRef.current = (pulsePhaseRef.current + 1) % 2;

      Object.values(latestByTruck).forEach((truck) => {
        const marker = markersRef.current[truck.truck_id];
        if (!marker) return;

        const risk = classifyRisk(truck);
        const color = riskColor(risk);

        const radius =
          risk === "critical"
            ? pulsePhaseRef.current === 0
              ? 10
              : 15
            : risk === "warning"
            ? 9
            : 7;

        marker.setStyle({
          radius,
          color,
          fillColor: color,
          fillOpacity: risk === "critical" ? 0.9 : 0.75,
          weight: 2,
        });
      });
    }, 850);

    return () => clearInterval(interval);
  }, [latestByTruck]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at top, #0f172a 0%, #020617 40%, #020617 100%)",
        color: "white",
        padding: 24,
        fontFamily: "Inter, Arial, sans-serif",
      }}
    >
      <div style={{ maxWidth: 1600, margin: "0 auto" }}>
        <div style={{ marginBottom: 22 }}>
          <div
            style={{
              fontSize: 58,
              fontWeight: 800,
              letterSpacing: "-1.5px",
              lineHeight: 1.05,
              marginBottom: 10,
            }}
          >
            Global Cold Chain Fleet Monitor
          </div>

          <div style={{ color: "#94a3b8", fontSize: 22, marginBottom: 14 }}>
            Real-time fleet telemetry.
          </div>

          <div
            style={{
              display: "flex",
              gap: 16,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                color: connected ? "#4ade80" : "#f87171",
                fontWeight: 700,
                fontSize: 18,
              }}
            >
              {connected ? "Connected to live stream" : "Disconnected"}
            </div>

            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search truck, route, region, status"
              style={{
                width: 320,
                background: "#111827",
                color: "white",
                border: "1px solid #334155",
                borderRadius: 12,
                padding: "10px 14px",
                outline: "none",
              }}
            />
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: 16,
            marginBottom: 24,
          }}
        >
          <StatCard
            label="Active Trucks"
            value={metrics.active}
            color="#38bdf8"
            subtitle="Live entities in current stream"
          />
          <StatCard
            label="Critical Temp"
            value={metrics.critical}
            color="#ef4444"
            subtitle="Immediate temperature breach"
          />
          <StatCard
            label="Warnings"
            value={metrics.warning}
            color="#f59e0b"
            subtitle="Door open or delayed state"
          />
          <StatCard
            label="Completed"
            value={metrics.completed}
            color="#22c55e"
            subtitle="Journeys marked complete"
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.8fr 1fr",
            gap: 24,
            marginBottom: 24,
          }}
        >
          <div
            style={{
              background: "#111827",
              border: "1px solid #334155",
              borderRadius: 18,
              padding: 18,
              boxShadow: "0 20px 40px rgba(0,0,0,.25)",
            }}
          >
            <div style={{ fontSize: 30, fontWeight: 700, marginBottom: 14 }}>
              Live Fleet Map
            </div>

            <div
              ref={mapRef}
              style={{
                height: 500,
                borderRadius: 14,
                overflow: "hidden",
                border: "1px solid #334155",
              }}
            />
          </div>

          <div style={{ display: "grid", gap: 24 }}>
            <div
              style={{
                background: "#111827",
                border: "1px solid #334155",
                borderRadius: 18,
                padding: 18,
                boxShadow: "0 20px 40px rgba(0,0,0,.25)",
              }}
            >
              <div style={{ fontSize: 26, fontWeight: 700, marginBottom: 14 }}>
                Highest Temperature Risk
              </div>

              {highestRiskTruck ? (
                <>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      marginBottom: 14,
                      gap: 12,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 36, fontWeight: 800 }}>
                        {highestRiskTruck.truck_id}
                      </div>
                      <div style={{ color: "#94a3b8", fontSize: 15, marginTop: 4 }}>
                        {highestRiskTruck.route_name}
                      </div>
                    </div>

                    <div
                      style={{
                        background: `${riskColor(classifyRisk(highestRiskTruck))}22`,
                        color: riskColor(classifyRisk(highestRiskTruck)),
                        border: `1px solid ${riskColor(classifyRisk(highestRiskTruck))}55`,
                        borderRadius: 999,
                        padding: "8px 12px",
                        fontSize: 13,
                        fontWeight: 700,
                      }}
                    >
                      {riskLabel(classifyRisk(highestRiskTruck))}
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 12,
                    }}
                  >
                    <MetricBox
                      title="Temperature"
                      value={`${highestRiskTruck.temperature_c}°C`}
                      color={riskColor(classifyRisk(highestRiskTruck))}
                    />
                    <MetricBox
                      title="Delay"
                      value={`${highestRiskTruck.delay_minutes}m`}
                    />
                    <MetricBox
                      title="Door"
                      value={highestRiskTruck.door_status}
                    />
                    <MetricBox
                      title="Journey"
                      value={highestRiskTruck.journey_status}
                    />
                  </div>
                </>
              ) : (
                <div style={{ color: "#94a3b8" }}>Waiting for data...</div>
              )}
            </div>

            <div
              style={{
                background: "#111827",
                border: "1px solid #334155",
                borderRadius: 18,
                padding: 18,
                boxShadow: "0 20px 40px rgba(0,0,0,.25)",
                height: 360,
              }}
            >
              <div style={{ fontSize: 26, fontWeight: 700, marginBottom: 12 }}>
                Top Heat Ranking
              </div>

              <div style={{ width: "100%", height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={rankingData}
                    layout="vertical"
                    margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis type="number" stroke="#94a3b8" />
                    <YAxis
                      type="category"
                      dataKey="truck_id"
                      width={48}
                      stroke="#94a3b8"
                    />
                    <Tooltip
                      contentStyle={{
                        background: "#020617",
                        border: "1px solid #334155",
                        borderRadius: 12,
                      }}
                    />
                    <Bar dataKey="temperature_c" radius={[0, 12, 12, 0]}>
                      {rankingData.map((entry, i) => (
                        <Cell key={i} fill={riskColor(entry.risk)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.35fr 1fr",
            gap: 24,
            marginBottom: 24,
          }}
        >
          <div
            style={{
              background: "#111827",
              border: "1px solid #334155",
              borderRadius: 18,
              padding: 18,
              boxShadow: "0 20px 40px rgba(0,0,0,.25)",
            }}
          >
            <div style={{ fontSize: 26, fontWeight: 700, marginBottom: 14 }}>
              Latest Truck States
            </div>

            <div
              style={{
                maxHeight: 460,
                overflow: "auto",
                border: "1px solid #334155",
                borderRadius: 14,
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead style={{ position: "sticky", top: 0, background: "#0f172a" }}>
                  <tr>
                    <th style={th}>Truck</th>
                    <th style={th}>Route</th>
                    <th style={th}>Temp</th>
                    <th style={th}>Status</th>
                    <th style={th}>Door</th>
                    <th style={th}>Delay</th>
                  </tr>
                </thead>
                <tbody>
                  {trucks.map((truck) => (
                    <tr key={truck.truck_id}>
                      <td style={tdStrong}>{truck.truck_id}</td>
                      <td style={td}>{truck.route_name}</td>
                      <td
                        style={{
                          ...td,
                          color: riskColor(classifyRisk(truck)),
                          fontWeight: 700,
                        }}
                      >
                        {truck.temperature_c}°C
                      </td>
                      <td style={td}>{truck.journey_status}</td>
                      <td style={td}>{truck.door_status}</td>
                      <td style={td}>{truck.delay_minutes}m</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div
            style={{
              background: "#111827",
              border: "1px solid #334155",
              borderRadius: 18,
              padding: 18,
              boxShadow: "0 20px 40px rgba(0,0,0,.25)",
            }}
          >
            <div style={{ fontSize: 26, fontWeight: 700, marginBottom: 14 }}>
              Live Event Feed
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                maxHeight: 460,
                overflow: "auto",
              }}
            >
              {feed.map((item) => (
                <div
                  key={item.id}
                  style={{
                    border: "1px solid rgba(255,255,255,.08)",
                    background: "rgba(255,255,255,.03)",
                    borderRadius: 14,
                    padding: 12,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      marginBottom: 6,
                    }}
                  >
                    <div style={{ fontWeight: 700, color: "#e2e8f0" }}>
                      {item.truck_id} • {item.route_name}
                    </div>
                    <div style={{ fontSize: 12, color: "#64748b" }}>
                      {formatTime(item.event_time)}
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 6,
                      fontSize: 14,
                    }}
                  >
                    <div style={{ color: riskColor(item.risk) }}>
                      Temp: {item.temperature_c}°C
                    </div>
                    <div style={{ color: "#cbd5e1" }}>
                      Journey: {item.journey_status}
                    </div>
                    <div style={{ color: "#cbd5e1" }}>
                      Door: {item.door_status}
                    </div>
                    <div style={{ color: "#cbd5e1" }}>
                      Delay: {item.delay_minutes}m
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div
          style={{
            background: "#111827",
            border: "1px solid #334155",
            borderRadius: 18,
            padding: 18,
            boxShadow: "0 20px 40px rgba(0,0,0,.25)",
          }}
        >
          <div style={{ fontSize: 26, fontWeight: 700, marginBottom: 14 }}>
            Highest Temperature Risk Trend
          </div>

          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={highestRiskTruck?.history || []}>
                <defs>
                  <linearGradient id="riskFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="t" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip
                  contentStyle={{
                    background: "#020617",
                    border: "1px solid #334155",
                    borderRadius: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="temp"
                  stroke="#ef4444"
                  strokeWidth={3}
                  fill="url(#riskFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

const th = {
  textAlign: "left",
  padding: 12,
  borderBottom: "1px solid #334155",
  color: "#94a3b8",
  fontWeight: 600,
  background: "#0f172a",
};

const td = {
  padding: 12,
  borderBottom: "1px solid #1f2937",
  color: "#cbd5e1",
};

const tdStrong = {
  padding: 12,
  borderBottom: "1px solid #1f2937",
  color: "white",
  fontWeight: 700,
};