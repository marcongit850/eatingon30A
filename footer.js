(function () {
  var mount = document.getElementById("site-footer");
  if (!mount) return;

  fetch("/includes/footer.html")
    .then(function (response) {
      if (!response.ok) throw new Error("footer");
      return response.text();
    })
    .then(function (html) {
      mount.innerHTML = html;
    });
})();
