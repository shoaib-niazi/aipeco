// =====================================================
// App.jsx - AiPECO React Application Root
// =====================================================
import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";

import Navbar         from "./components/Navbar";
import Dashboard      from "./components/Dashboard";
import ForecastChart  from "./components/ForecastChart";
import NILMPanel      from "./components/NILMPanel";
import AnomalyAlerts  from "./components/AnomalyAlerts";
import TrainModels    from "./components/TrainModels";

import "./styles/App.css";

function App() {
  return (
    <Router>
      <div style={{ minHeight: "100vh", backgroundColor: "#0f172a", color: "#f1f5f9" }}>
        <Navbar />
        <main>
          <Routes>
            <Route path="/"          element={<Dashboard />}     />
            <Route path="/forecast"  element={<ForecastChart />} />
            <Route path="/nilm"      element={<NILMPanel />}     />
            <Route path="/anomalies" element={<AnomalyAlerts />} />
            <Route path="/train"     element={<TrainModels />}   />
            <Route path="*" element={
              <div style={{ textAlign: "center", padding: "80px", color: "#64748b" }}>
                <h2>404 - Page Not Found</h2>
                <p>Go back to <a href="/" style={{ color: "#38bdf8" }}>Dashboard</a></p>
              </div>
            } />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;