// Apply the saved theme before CSS loads to prevent a wrong-theme flash during refresh.
try {
  document.documentElement.dataset.theme = localStorage.getItem("sysml.theme") === "light" ? "light" : "dark";
} catch {
  document.documentElement.dataset.theme = "dark";
}
