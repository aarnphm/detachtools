try {
  const theme = localStorage.getItem("theme")
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme
} catch {}
