import { useState, useEffect } from 'react';
import { fetchLiveStatus } from './mockData';
import { ShieldCheck, ShieldAlert, Droplet, Thermometer, BoxSelect, Activity, RotateCcw, Phone, CheckCircle2, Bell } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

function App() {
  const [dataPayload, setDataPayload] = useState(null);
  const [offline, setOffline] = useState(false);
  const [lastSync, setLastSync] = useState(Date.now());
  const [activeTab, setActiveTab] = useState('home');

  useEffect(() => {
    let isMounted = true;
    const poll = async () => {
      try {
        // Try the real API first
        const response = await fetch('/api/status');
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
  let titleStr = "Water is Safe";
  let subStr = "Clear for drinking and use";

  if (isDanger) {
    headerBg = "bg-red-600 animate-pulse";
    mainIcon = <ShieldAlert className="w-16 h-16 mx-auto mb-2 text-white" />;
    titleStr = "Water Unsafe";
    subStr = data.reason || "Stop using immediately";
  } else if (isWarning) {
    headerBg = "bg-amber-500";
    mainIcon = <ShieldAlert className="w-16 h-16 mx-auto mb-2 text-white" />;
    titleStr = "Something is Off";
    subStr = "Keep an eye on it";
  }

  const handleCall = () => window.location.href = "tel:18001234567";
  const unackedAlerts = alerts.filter(a => !a.acknowledged).length;

  return (
    <div className="bg-gray-100 min-h-screen pb-24 font-sans text-gray-800">
      
      {offline && (
        <div className="bg-gray-800 text-white text-xs text-center py-1 flex items-center justify-center gap-1">
          <Activity size={12}/> Offline (Using Cached Data)
        </div>
      )}

      {/* DASHBOARD TAB */}
      {activeTab === 'home' && (
        <div className="flex flex-col animate-in fade-in zoom-in-95 duration-200">
          <div className={`${headerBg} transition-colors duration-500 text-white p-8 text-center rounded-b-3xl shadow-lg`}>
            {mainIcon}
            <h1 className="text-4xl font-bold tracking-tight mb-2">{titleStr}</h1>
            <p className="text-lg opacity-90">{subStr}</p>
            {isDanger && (
              <button onClick={handleCall} className="mt-4 bg-white text-red-600 font-bold px-6 py-3 rounded-full flex items-center justify-center mx-auto gap-2 shadow-xl active:scale-95 transition-transform">
                <Phone size={20} /> Call for Help
              </button>
            )}
          </div>

          <div className="p-4 space-y-4 -mt-4 relative z-10">
            <SensorCard icon={<Droplet className="text-blue-500" />} title="Clarity (Turbidity)" value={Math.round(data.turbidity)} unit="NTU" desc={data.turbidity > 500 ? "Cloudy" : "Clear"} isBad={data.turbidity > 1000} />
            <SensorCard icon={<BoxSelect className="text-amber-500" />} title="Dissolved Minerals" value={Math.round(data.tds)} unit="ppm" desc={data.tds > 300 ? "High" : "Normal"} isBad={data.tds > 500} />
            
            <div className="bg-white p-4 rounded-xl shadow-sm">
              <h3 className="text-xs font-bold text-gray-500 mb-2 uppercase tracking-wide">Live Trend (Turbidity)</h3>
              <div className="h-24">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history}>
                    <Line type="monotone" dataKey="turbidity" stroke="#3B82F6" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white rounded-xl p-3 text-xs text-gray-500 flex justify-between items-center shadow-sm">
              <span className="flex items-center gap-1"><RotateCcw size={14}/> Updated {Math.floor((Date.now() - data.last_seen)/1000)}s ago (Edge Sync)</span>
              <span>Bat: {data.battery}%</span>
            </div>
          </div>
        </div>
      )}

      {/* ALERTS TAB */}
      {activeTab === 'alerts' && (
        <div className="p-4 animate-in fade-in slide-in-from-right-4 duration-200">
          <h2 className="text-2xl font-bold mb-4 flex items-center gap-2"><Bell className="text-gray-400"/> Alerts History</h2>
          
          {alerts.length === 0 ? (
            <div className="text-center p-8 bg-white rounded-2xl shadow-sm text-gray-400">
              <CheckCircle2 className="w-12 h-12 mx-auto mb-2 text-green-400"/>
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
                      <Phone size={16}/> Call
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
           <h2 className="text-2xl font-bold mb-4 flex items-center gap-2"><Activity className="text-gray-400"/> Trends</h2>
           
           <div className="bg-white p-4 rounded-2xl shadow-sm">
              <h3 className="font-bold text-gray-700 mb-4">Clarity (Turbidity) Range</h3>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                    <XAxis dataKey="time" tick={{fontSize: 10}} tickMargin={10} minTickGap={30} stroke="#9CA3AF" />
                    <YAxis tick={{fontSize: 10}} stroke="#9CA3AF" width={30}/>
                    <Tooltip contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                    <Line type="monotone" dataKey="turbidity" stroke="#3B82F6" strokeWidth={3} dot={false} activeDot={{r: 6}} />
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
                    <XAxis dataKey="time" tick={{fontSize: 10}} tickMargin={10} minTickGap={30} stroke="#9CA3AF" />
                    <YAxis tick={{fontSize: 10}} stroke="#9CA3AF" width={30}/>
                    <Tooltip contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                    <Line type="monotone" dataKey="tds" stroke="#F59E0B" strokeWidth={3} dot={false} activeDot={{r: 6}} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
           </div>
         </div>
      )}

      {/* BOTTOM NAVIGATION */}
      <div className="fixed bottom-0 w-full bg-white flex justify-around pb-1 pt-2 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-50">
        <NavBtn id="home" label="Home" icon={<ShieldCheck/>} active={activeTab} setTab={setActiveTab} />
        <NavBtn id="alerts" label="Alerts" icon={<ShieldAlert/>} active={activeTab} setTab={setActiveTab} badge={unackedAlerts} />
        <NavBtn id="trends" label="Trends" icon={<Activity/>} active={activeTab} setTab={setActiveTab} />
      </div>

    </div>
  );
}

function SensorCard({icon, title, value, unit, desc, isBad}) {
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

function NavBtn({id, label, icon, active, setTab, badge}) {
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
