// Apply the saved theme before CSS loads to prevent a wrong-theme flash during refresh.
try {
  const theme = localStorage.getItem("sysml.theme") === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
} catch {
  document.documentElement.dataset.theme = "dark";
  document.documentElement.style.colorScheme = "dark";
}
