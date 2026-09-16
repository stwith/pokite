import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./theme.css";
import "./layout.css";
import "github-markdown-css/github-markdown-light.css";
import "./markdown.css";

createRoot(document.getElementById("root")).render(<App />);
