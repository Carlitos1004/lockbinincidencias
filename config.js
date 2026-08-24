// =========================================================================
// PEGA AQUÍ TUS 2 VALORES DE SUPABASE
// (Project Settings → API, en tu proyecto de supabase.com)
// =========================================================================
const SUPABASE_URL = "https://haoveumvgejetfqpmwtj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhhb3ZldW12Z2VqZXRmcXBtd3RqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1NjU1NjcsImV4cCI6MjEwMzE0MTU2N30.P0amDoIYqPZ60VCvGvr1ISUccNgXUzrD2BaJTSD-FIA";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
