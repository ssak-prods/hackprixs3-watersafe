import { useState, useEffect } from 'react';
import { fetchLiveStatus } from './mockData';
import {
  ShieldCheck,
  ShieldAlert,
  Droplet,
  Thermometer,
  BoxSelect,
  Activity,
  RotateCcw,
  Phone,
  CheckCircle2,
  Bell,
  Settings,
  X
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

function getTimeAgo(timestamp) {
  const diff = Math.floor((Date.now() - timestamp) / 1000);

  if (diff < 60) {
    return `${diff}s ago`;
  }

  if (diff < 3600) {
    return `${Math.floor(diff / 60)}m ago`;
  }

  return `${Math.floor(diff / 3600)}h ago`;
}

const translations = {
  en: {
    waterStabilityScore: "Water Stability Score",
    waterClarity: "Water Clarity",
    mineralContent: "Mineral Content",
    temperature: "Temperature",
    lastUpdate: "Last Update",
    notifications: "Notifications",
    settings: "Settings",
    monitoringActive: "Monitoring Active",
    home: "Home",
    alerts: "Alerts",
    trends: "Trends",
    overallQualityTrend: "Overall Quality Trend",
    safeTitle: "Water is Safe",
    safeSubtitle: "Clear for drinking and use",
    unsafeTitle: "Water Unsafe",
    unsafeSubtitle: "Do not use until issue is resolved",
    callForHelp: "Call for Help",
    voiceAssistant: "Voice Assistant",
    listenStatus: "Listen Status",

    safeVoice:
      "Water is safe. Safe for drinking and daily use.",

    unsafeVoice:
      "Warning. Unsafe water detected. Do not use the water until the issue is resolved.",

  },

  hi: {
    waterStabilityScore: "जल स्थिरता स्कोर",
    waterClarity: "पानी की स्पष्टता",
    mineralContent: "खनिज मात्रा",
    temperature: "तापमान",
    lastUpdate: "अंतिम अपडेट",
    notifications: "सूचनाएं",
    settings: "सेटिंग्स",
    monitoringActive: "निगरानी सक्रिय",
    home: "होम",
    alerts: "सूचनाएं",
    trends: "रुझान",
    overallQualityTrend: "समग्र जल गुणवत्ता प्रवृत्ति",
    safeTitle: "पानी सुरक्षित है",
    safeSubtitle: "पीने और उपयोग के लिए सुरक्षित",
    unsafeTitle: "पानी असुरक्षित है",
    unsafeSubtitle: "समस्या हल होने तक उपयोग न करें",
    callForHelp: "सहायता के लिए कॉल करें",
    voiceAssistant: "वॉयस असिस्टेंट",
    listenStatus: "स्थिति सुनें",

    safeVoice:
      "पानी सुरक्षित है। पीने और उपयोग के लिए सुरक्षित है।",

    unsafeVoice:
      "चेतावनी। असुरक्षित पानी पाया गया है। समस्या हल होने तक पानी का उपयोग न करें।",
  },

  te: {
    waterStabilityScore: "నీటి స్థిరత్వ స్కోర్",
    waterClarity: "నీటి స్పష్టత",
    mineralContent: "ఖనిజ పరిమాణం",
    temperature: "ఉష్ణోగ్రత",
    lastUpdate: "చివరి నవీకరణ",
    notifications: "నోటిఫికేషన్లు",
    settings: "సెట్టింగులు",
    monitoringActive: "పర్యవేక్షణ సక్రియంగా ఉంది",
    home: "హోమ్",
    alerts: "నోటిఫికేషన్లు",
    trends: "ట్రెండ్స్",
    overallQualityTrend: "మొత్తం నీటి నాణ్యత ధోరణి",
    safeTitle: "నీరు సురక్షితంగా ఉంది",
    safeSubtitle: "తాగడానికి మరియు ఉపయోగించడానికి సురక్షితం",
    unsafeTitle: "నీరు సురక్షితం కాదు",
    unsafeSubtitle: "సమస్య పరిష్కారం అయ్యే వరకు ఉపయోగించవద్దు",
    callForHelp: "సహాయం కోసం కాల్ చేయండి",
    voiceAssistant: "వాయిస్ అసిస్టెంట్",
    listenStatus: "స్థితిని వినండి",

    safeVoice:
      "నీరు సురక్షితంగా ఉంది. తాగడానికి మరియు ఉపయోగించడానికి సురక్షితం.",

    unsafeVoice:
      "హెచ్చరిక. అసురక్షిత నీరు గుర్తించబడింది. సమస్య పరిష్కారం అయ్యే వరకు నీటిని ఉపయోగించవద్దు.",
  }
};


function App() {
  const [dataPayload, setDataPayload] = useState(null);
  const [offline, setOffline] = useState(false);
  const [lastSync, setLastSync] = useState(Date.now());
  const [activeTab, setActiveTab] = useState('home');
  const [language, setLanguage] = useState('en');
  const [showSettings, setShowSettings] = useState(false);
  const t = translations[language];

  const speakText = (text) => {
    console.log("Speaking:", text);

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);

    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;

    utterance.lang =
      language === "hi"
        ? "hi-IN"
        : language === "te"
          ? "te-IN"
          : "en-US";

    window.speechSynthesis.speak(utterance);
  };

  // TEMPORARY DEBUGGING
  useEffect(() => {
    setTimeout(() => {
      console.log(window.speechSynthesis.getVoices());
    }, 1000);
  }, []);

  useEffect(() => {
    let isMounted = true;
    const API_BASE = import.meta.env.VITE_API_URL || '';
    const poll = async () => {
      try {
        // Fetch from the Railway URL directly
        const response = await fetch(`${API_BASE}/api/status`);
        if (!response.ok) throw new Error('API down');
        const res = await response.json();

        if (isMounted) {
          setDataPayload(res);
          setOffline(false);
          setLastSync(Date.now());
        }
      } catch (e) {
        // Fallback to Mock Data Engine if no backend/internet
        try {
          const mockRes = await fetchLiveStatus();
          if (isMounted) {
            setDataPayload(mockRes);
            setOffline(true);
            setLastSync(Date.now());
          }
        } catch (mockErr) {
          if (isMounted) setOffline(true);
        }
      }
      if (isMounted) setTimeout(poll, 3000);
    };
    poll();
    return () => { isMounted = false; };
  }, []);

  if (!dataPayload) {
    return <div className="flex items-center justify-center min-h-screen">Loading WaterSafe...</div>;
  }

  const { current: data, alerts, history } = dataPayload;

  const isDanger = data.alert_level >= 3;
  const isWarning = data.alert_level > 0 && data.alert_level < 3;

  let headerBg = "bg-green-500";
  let mainIcon = <ShieldCheck className="w-16 h-16 mx-auto mb-2 text-white" />;

  let titleStr = t.safeTitle;
  let subStr = t.safeSubtitle;

  if (isDanger) {
    headerBg = "bg-red-600 animate-pulse";
    mainIcon = <ShieldAlert className="w-16 h-16 mx-auto mb-2 text-white" />;

    titleStr = t.unsafeTitle;
    subStr = t.unsafeSubtitle;
  }

  const handleCall = () => window.location.href = "tel:18001234567";
  const unackedAlerts = alerts.filter(a => !a.acknowledged).length;

  return (
    <div className="bg-gray-100 min-h-screen pb-24 font-sans text-gray-800">

      {offline && (
        <div className="bg-gray-800 text-white text-xs text-center py-1 flex items-center justify-center gap-1">
          <Activity size={12} /> Offline (Using Cached Data)
        </div>
      )}

      {/* DASHBOARD TAB */}
      {activeTab === 'home' && (
        <div className="flex flex-col animate-in fade-in zoom-in-95 duration-200">
          <div className={`${headerBg} transition-colors duration-500 text-white p-8 text-center rounded-b-3xl shadow-lg`}>
            <div className="flex justify-end mb-4">
              <button
                onClick={() => setShowSettings(true)}
                className="bg-white/20 backdrop-blur-sm p-2 rounded-full"
              >
                <Settings size={22} />
              </button>
            </div>

            {mainIcon}

            <h1 className="text-4xl font-bold tracking-tight mb-2">
              {titleStr}
            </h1>

            <p className="text-lg opacity-90">
              {subStr}
            </p>
            <button
              onClick={() =>
                speakText(
                  isDanger
                    ? t.unsafeVoice
                    : t.safeVoice
                )
              }
              className="mt-4 bg-white/20 backdrop-blur-sm px-4 py-2 rounded-full text-sm font-medium"
            >
              🔊 {t.voiceAssistant}
            </button>
            <button
              onClick={() => {
                const utterance = new SpeechSynthesisUtterance(
                  "Hello WaterSafe"
                );

                window.speechSynthesis.speak(utterance);
              }}
              className="mt-2 bg-blue-500 text-white px-4 py-2 rounded-full text-sm"
            >
              Test Voice
            </button>
            {isDanger && (
              <button onClick={handleCall} className="mt-4 bg-white text-red-600 font-bold px-6 py-3 rounded-full flex items-center justify-center mx-auto gap-2 shadow-xl active:scale-95 transition-transform">
                <Phone size={20} /> {t.callForHelp}
              </button>
            )}
          </div>

          <div className="p-4 space-y-4 -mt-4 relative z-10">
            <SensorCard icon={<Droplet className="text-blue-500" />} title={t.waterClarity} value={Math.round(data.turbidity)} unit="NTU" desc={data.turbidity > 500 ? "Cloudy" : "Clear"} isBad={data.turbidity > 1000} />
            <SensorCard icon={<BoxSelect className="text-amber-500" />} title={t.mineralContent} value={Math.round(data.tds)} unit="ppm" desc={data.tds > 300 ? "High" : "Normal"} isBad={data.tds > 500} />
            <SensorCard
              icon={<Thermometer className="text-red-500" />}
              title={t.temperature}
              value={Math.round(data.temperature)}
              unit="°C"
              desc="Normal"
              isBad={false}
            />
            <div className="bg-white p-4 rounded-xl shadow-sm">
              <h3 className="text-xs font-bold text-gray-500 mb-2 uppercase tracking-wide">{t.overallQualityTrend}</h3>
              <div className="h-24">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history}>
                    <Line type="monotone" dataKey="turbidity" stroke="#3B82F6" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white rounded-xl p-3 text-xs text-gray-500 flex items-center gap-2 shadow-sm">
              <RotateCcw size={14} />
              {t.lastUpdate}: {getTimeAgo(data.last_seen)}
            </div>
          </div>
        </div>
      )}

      {/* ALERTS TAB */}
      {activeTab === 'alerts' && (
        <div className="p-4 animate-in fade-in slide-in-from-right-4 duration-200">
          <h2 className="text-2xl font-bold mb-4 flex items-center gap-2"><Bell className="text-gray-400" /> Alerts History</h2>

          {alerts.length === 0 ? (
            <div className="text-center p-8 bg-white rounded-2xl shadow-sm text-gray-400">
              <CheckCircle2 className="w-12 h-12 mx-auto mb-2 text-green-400" />
              <p>All clean. No active alerts.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {alerts.map((alert) => (
                <div key={alert.id} className="bg-white rounded-2xl p-4 shadow-sm border-l-4 border-red-500">
                  <div className="text-xs text-red-500 font-bold uppercase tracking-wider mb-1">{alert.time}</div>
                  <h3 className="font-bold text-lg leading-tight mb-1">{alert.message}</h3>
                  <p className="text-sm text-gray-600 mb-4">{alert.action}</p>
                  <div className="flex gap-2">
                    <button onClick={handleCall} className="flex-1 bg-red-50 text-red-600 py-2 rounded-lg font-bold flex justify-center items-center gap-1">
                      <Phone size={16} /> Call
                    </button>
                    {!alert.acknowledged && (
                      <button className="flex-1 bg-gray-100 text-gray-600 py-2 rounded-lg font-bold">
                        Acknowledge
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TRENDS TAB */}
      {activeTab === 'trends' && (
        <div className="p-4 animate-in fade-in slide-in-from-right-4 duration-200 space-y-6">
          <h2 className="text-2xl font-bold mb-4 flex items-center gap-2"><Activity className="text-gray-400" /> Trends</h2>

          <div className="bg-white p-4 rounded-2xl shadow-sm">
            <h3 className="font-bold text-gray-700 mb-4">Clarity (Turbidity) Range</h3>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} tickMargin={10} minTickGap={30} stroke="#9CA3AF" />
                  <YAxis tick={{ fontSize: 10 }} stroke="#9CA3AF" width={30} />
                  <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                  <Line type="monotone" dataKey="turbidity" stroke="#3B82F6" strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl shadow-sm">
            <h3 className="font-bold text-gray-700 mb-4">Dissolved Minerals (TDS)</h3>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} tickMargin={10} minTickGap={30} stroke="#9CA3AF" />
                  <YAxis tick={{ fontSize: 10 }} stroke="#9CA3AF" width={30} />
                  <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                  <Line type="monotone" dataKey="tds" stroke="#F59E0B" strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40"
            onClick={() => setShowSettings(false)}
          />

          <div className="fixed top-0 right-0 h-full w-72 bg-white shadow-xl z-50 p-5 animate-in slide-in-from-right duration-300">

            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">
                Settings
              </h2>

              <button
                onClick={() => setShowSettings(false)}
              >
                <X />
              </button>
            </div>

            <div className="space-y-4">

              <div className="border rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">
                    🌐 Language
                  </span>
                </div>

                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full border rounded-lg p-2 text-sm"
                >
                  <option value="en">English</option>
                  <option value="hi">हिन्दी</option>
                  <option value="te">తెలుగు</option>
                </select>
              </div>

              <div className="border rounded-xl p-3">
                🔊 Audio Alerts
              </div>

              <div className="border rounded-xl p-3">
                🌙 Dark Mode
              </div>

            </div>

          </div>
        </>
      )}

      {/* BOTTOM NAVIGATION */}
      <div className="fixed bottom-0 w-full bg-white flex justify-around pb-1 pt-2 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-50">
        <NavBtn id="home" label={t.home} icon={<ShieldCheck />} active={activeTab} setTab={setActiveTab} />
        <NavBtn id="alerts" label={t.alerts} icon={<ShieldAlert />} active={activeTab} setTab={setActiveTab} badge={unackedAlerts} />
        <NavBtn id="trends" label={t.trends} icon={<Activity />} active={activeTab} setTab={setActiveTab} />
      </div>

    </div>
  );
}

function SensorCard({ icon, title, value, unit, desc, isBad }) {
  return (
    <div className={`bg-white rounded-2xl p-4 shadow-sm flex items-center justify-between border-l-4 ${isBad ? 'border-red-500 bg-red-50' : 'border-green-500'}`}>
      <div className="flex items-center gap-4">
        <div className="p-2 bg-gray-50 rounded-lg">{icon}</div>
        <div>
          <h3 className="text-sm text-gray-500 font-medium">{title}</h3>
          <p className="text-xs text-gray-400">{desc}</p>
        </div>
      </div>
      <div className="text-right">
        <div className="text-2xl font-bold text-gray-800">{value}</div>
        <div className="text-xs text-gray-400 leading-none">{unit}</div>
      </div>
    </div>
  )
}

function NavBtn({ id, label, icon, active, setTab, badge }) {
  const isActive = active === id;
  return (
    <button onClick={() => setTab(id)} className={`relative flex flex-col items-center p-2 min-w-[70px] ${isActive ? 'text-blue-600' : 'text-gray-400'}`}>
      {badge > 0 && (
        <span className="absolute top-0 right-2 bg-red-500 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold">
          {badge}
        </span>
      )}
      <div className={`${isActive ? 'scale-110 mb-1' : 'mb-1'} transition-all`}>
        {icon}
      </div>
      <span className={`text-[10px] font-medium transition-colors ${isActive ? 'text-blue-600' : 'text-gray-500'}`}>{label}</span>
    </button>
  )
}


export default App;