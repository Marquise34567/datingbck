"use client";

import { useEffect } from "react";
import { apiFetch } from "../lib/api";

export default function InitToken() {
  useEffect(() => {
    let mounted = true;
    async function init() {
      try {
        await apiFetch('/token', { method: 'POST' });
      } catch (e) {
        // ignore
      }
    }
    init();
    return () => { mounted = false; };
  }, []);
  return null;
}
