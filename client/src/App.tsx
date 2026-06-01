import { Route, Routes } from "react-router-dom";

import Layout from "./components/Layout";
import Home from "./pages/Home";
import Submit from "./pages/Submit";
import UserPage from "./pages/UserPage";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/submit" element={<Submit />} />
        <Route path="/u/:name" element={<UserPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
