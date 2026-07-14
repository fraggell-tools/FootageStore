(function () {
  var t = localStorage.getItem("fg-theme") || "dark";
  document.documentElement.setAttribute("data-theme", t);
})();
