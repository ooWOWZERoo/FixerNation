/* Fixer Nation Education: the Academic Year choices for a classroom.
   The list starts at the school year we are in now and runs 13 school years (kindergarten through grade 12), so a child who
   starts kindergarten this year can be followed until they graduate from high school. It moves forward on its own each August,
   so nobody has to edit it. A school year runs August through July.
   FnSchoolYears.fill(select, saved) fills a <select> and, if a classroom already holds a year that is not in the list (an older
   one, or one typed another way), keeps it as a choice so editing the classroom never blanks it. */
(function () {
  var COUNT = 13; // kindergarten + grades 1 to 12
  function startYear(now) {
    var d = now || new Date();
    return d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1; // August (month 7) starts the new school year
  }
  function list(now) {
    var s = startYear(now), out = [];
    for (var i = 0; i < COUNT; i++) out.push((s + i) + '–' + (s + i + 1));
    return out;
  }
  function fill(select, saved) {
    if (!select) return;
    var years = list();
    var html = '<option value="">— Select year —</option>' + years.map(function (y) { return '<option>' + y + '</option>'; }).join('');
    var keep = saved ? String(saved).trim() : '';
    if (keep && years.indexOf(keep) < 0) html += '<option>' + keep.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</option>';
    select.innerHTML = html;
    select.value = keep;
  }
  window.FnSchoolYears = { list: list, fill: fill, startYear: startYear, COUNT: COUNT };
})();
