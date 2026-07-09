import { Thermometer, CloudRain, Wind, Droplets, MapPin, CloudOff } from "lucide-react";

export default function WeatherForecast({ weather }) {
  if (!weather) return null;

  if (weather.status === "too_far") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-gray-400 italic mb-3">
        <CloudOff size={12} /> Forecast available closer to the date
      </div>
    );
  }

  if (weather.status !== "ok") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-gray-400 italic mb-3">
        <CloudOff size={12} /> Weather unavailable
      </div>
    );
  }

  return (
    <div className="mb-3 bg-white/60 rounded-lg px-3 py-2 border border-white/80">
      <div className="flex items-center gap-1 text-[11px] text-gray-500 mb-1.5">
        <MapPin size={10} /> {weather.venue}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-700">
        <span className="flex items-center gap-1">
          <Thermometer size={12} className="text-red-400" />
          {Math.round(weather.temp_c)}°C
          {weather.feels_like_c != null && ` (feels ${Math.round(weather.feels_like_c)}°C)`}
        </span>
        <span className="flex items-center gap-1">
          <CloudRain size={12} className="text-blue-400" />
          {weather.rain_chance_pct}% rain
        </span>
        <span className="flex items-center gap-1">
          <Wind size={12} className="text-gray-400" />
          {weather.wind_kph} km/h
        </span>
        <span className="flex items-center gap-1">
          <Droplets size={12} className="text-cyan-500" />
          {weather.humidity_pct}% humidity
        </span>
      </div>
    </div>
  );
}
