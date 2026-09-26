import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { locale } from "./lib/i18n.js";
import "./theme.css";
import "./layout.css";
import "github-markdown-css/github-markdown-light.css";
import "./markdown.css";

document.documentElement.lang = locale;
createRoot(document.getElementById("root")).render(<App />);
