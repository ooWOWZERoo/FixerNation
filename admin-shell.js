/* Mission Control presentation layer. Admin pages only; no API or auth changes. */
(function () {
  'use strict';
  var shell = document.querySelector('.a-shell');
  if (!shell) return;
  var page = location.pathname.split('/').pop();
  var pages = {
    'dashboard': ['Your mission, in motion', 'Mission Control', 'Real tools. Brighter futures. Track progress, support schools, and make your next move count.', 'Overview'],
    'account-lookup': ['People behind the progress', '', 'Find an account and connect the dots across invitations, access, and licenses.', 'Sales & Schools'],
    'affiliates': ['Grow the movement', '', 'Support your partners, explore territory coverage, and turn connections into opportunity.', 'Sales & Schools'],
    'analytics': ['Follow the journey', '', 'See how visitors discover Fixer Nation and where their next steps take them.', 'Reports'],
    'automations': ['Keep the momentum going', '', 'Manage the messages and workflows that help your community move forward.', 'Marketing & CRM'],
    'blogs': ['Ideas worth sharing', '', 'Create stories that spark confidence, connection, and a brighter school day.', 'Content'],
    'campaigns': ['Make your message matter', '', 'Bring your audience closer with purposeful campaigns and clear next steps.', 'Marketing & CRM'],
    'concierge': ['A strong start for every school', '', 'Guide each school from an accepted quote to a connected, ready-to-learn community.', 'Sales & Schools'],
    'content-safety': ['Care at the center', '', 'Review content and maintain the safeguards that support a positive learning experience.', 'Community'],
    'curriculum': ['Build brighter futures', '', 'Shape practical lessons that help students grow in confidence, character, and life skills.', 'Content'],
    'districts': ['Progress, together', '', 'Connect schools, support district leaders, and keep every learning community moving.', 'Sales & Schools'],
    'downloads': ['Resources in action', '', 'Explore the materials your community is using and the lessons reaching classrooms.', 'Reports'],
    'invoices': ['Keep progress on track', '', 'Follow purchase orders, payments, and the next steps that unlock school access.', 'Sales & Schools'],
    'licenses': ['Open the door to learning', '', 'Manage license products and help schools connect educators with the tools they need.', 'Sales & Schools'],
    'morning-boost-calendar': ['A little inspiration, every day', '', 'Plan the rhythm of Morning Boost and turn upcoming themes into ready-to-share stories.', 'Content'],
    'morning-boost-email': ['Start their day with possibility', '', 'Prepare your Morning Boost message, audience, and delivery schedule in one place.', 'Content'],
    'morning-boost': ['Small moments. Lasting impact.', '', 'Bring today’s theme to life and give your community a positive start.', 'Content'],
    'newsletter': ['People power the mission', '', 'Get to know your contacts, organize your audiences, and strengthen every connection.', 'Marketing & CRM'],
    'orders': ['Every order opens a door', '', 'Track purchases and help your customers take their next step with Fixer Nation.', 'Sales & Schools'],
    'quotes': ['From interest to impact', '', 'Build proposals, follow opportunities, and help more schools get started.', 'Sales & Schools'],
    'school-admins': ['Empower the people leading change', '', 'Connect school leaders with the access and responsibilities they need to support their teachers.', 'Sales & Schools'],
    'settings': ['Make it work for your mission', '', 'Manage the preferences, branding, and delivery settings behind your daily operations.', 'Administration'],
    'social': ['Connection creates momentum', '', 'Shape the conversations and shared moments that bring your community together.', 'Community']
  };
  var key = page.replace('admin-', '').replace('.html', '');
  var config = pages[key];
  if (!config) return;
  var topbar = shell.querySelector('.a-topbar');
  var content = shell.querySelector('.a-content');
  var sidebar = shell.querySelector('.a-sidebar');
  var title = topbar.querySelector('h1');
  document.body.dataset.workspace = key;
  content.id = content.id || 'admin-workspace';
  content.setAttribute('role', 'main');
  sidebar.id = 'admin-navigation';
  var skip = document.createElement('a');
  skip.className = 'mc-skip'; skip.href = '#' + content.id; skip.textContent = 'Skip to workspace';
  document.body.prepend(skip);
  var hero = document.createElement('section');
  hero.className = 'mc-hero' + (key === 'dashboard' ? ' mc-hero-dashboard' : '');
  var copy = document.createElement('div'); copy.className = 'mc-hero-copy';
  var eyebrow = document.createElement('p'); eyebrow.className = 'mc-eyebrow'; eyebrow.textContent = config[0];
  copy.appendChild(eyebrow);
  if (config[1]) title.textContent = config[1];
  copy.appendChild(title); // Preserve IDs and dynamic titles, especially Concierge.
  var desc = document.createElement('p'); desc.className = 'mc-description'; desc.textContent = config[2]; copy.appendChild(desc);
  hero.appendChild(copy);
  var tag = document.createElement('span'); tag.className = 'mc-hero-tag'; tag.textContent = 'BIG IDEAS. BRIGHTER KIDS.'; hero.appendChild(tag);
  content.prepend(hero);
  var tools = document.createElement('div'); tools.className = 'mc-topbar-start';
  var menu = document.createElement('button'); menu.type = 'button'; menu.className = 'mc-menu'; menu.textContent = '☰'; menu.setAttribute('aria-label', 'Open navigation'); menu.setAttribute('aria-controls', sidebar.id); menu.setAttribute('aria-expanded', 'false');
  tools.appendChild(menu);
  var crumb = document.createElement('div'); crumb.className = 'mc-breadcrumb';
  var home = document.createElement('a'); home.href = 'admin-dashboard.html'; home.textContent = 'FNE';
  crumb.appendChild(home); crumb.appendChild(document.createTextNode(' / ' + config[3])); tools.appendChild(crumb);
  topbar.prepend(tools);
  var searchWrap = document.createElement('div'); searchWrap.className = 'mc-page-search';
  var search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Find an admin page…'; search.setAttribute('aria-label', 'Find an admin page'); search.setAttribute('aria-controls', 'mc-page-results'); search.autocomplete = 'off';
  var results = document.createElement('div'); results.id = 'mc-page-results'; results.className = 'mc-page-results'; results.hidden = true;
  var status = document.createElement('span'); status.className = 'mc-sr-only'; status.setAttribute('aria-live', 'polite');
  searchWrap.append(search, results, status); tools.after(searchWrap);
  var links = Array.from(sidebar.querySelectorAll('a[href$=".html"]')).filter(function(a){return a.getAttribute('href').indexOf('admin-') === 0;}).map(function(a){return {href:a.getAttribute('href'),label:a.querySelector('.label').textContent};});
  links.push({href:'admin-morning-boost-calendar.html',label:'Morning Boost Calendar'});
  function closeSearch(){results.hidden = true;}
  search.addEventListener('input', function(){
    var term = search.value.trim().toLowerCase(); results.replaceChildren();
    if (!term) { closeSearch(); return; }
    var matches = links.filter(function(a){return a.label.toLowerCase().includes(term);});
    matches.forEach(function(a){var el=document.createElement('a');el.href=a.href;el.textContent=a.label;results.appendChild(el);});
    if (!matches.length) {var empty=document.createElement('p');empty.textContent='No matching pages';results.appendChild(empty);}
    status.textContent=matches.length+' matching pages'; results.hidden=false;
  });
  search.addEventListener('keydown',function(e){if(e.key==='ArrowDown' && !results.hidden){e.preventDefault();var first=results.querySelector('a');if(first)first.focus();} if(e.key==='Enter' && !results.hidden){var first=results.querySelector('a');if(first)first.click();} if(e.key==='Escape')closeSearch();});
  results.addEventListener('keydown',function(e){var items=Array.from(results.querySelectorAll('a'));var index=items.indexOf(document.activeElement);if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();var next=(index+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;if(items[next])items[next].focus();}if(e.key==='Escape'){closeSearch();search.focus();}});
  document.addEventListener('click',function(e){if(!searchWrap.contains(e.target))closeSearch();});
  var oldToggle=topbar.querySelector('.a-theme-toggle');
  if(oldToggle){var toggle=document.createElement('button');toggle.type='button';toggle.className=oldToggle.className;toggle.innerHTML='<span class="ic-sun"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/></svg></span><span class="ic-moon"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12Z"/></svg></span>';toggle.setAttribute('aria-label','Toggle light and dark theme');toggle.addEventListener('click',function(){fnToggleTheme();});oldToggle.replaceWith(toggle);fnSyncThemeToggleUI();}
  var overlay=document.createElement('button');overlay.type='button';overlay.className='mc-nav-backdrop';overlay.setAttribute('aria-label','Close navigation');overlay.tabIndex=-1;document.body.appendChild(overlay);
  var close=document.createElement('button');close.type='button';close.className='mc-nav-close';close.textContent='×';close.setAttribute('aria-label','Close navigation');sidebar.prepend(close);
  function setMenu(open){document.body.classList.toggle('mc-nav-open',open);menu.setAttribute('aria-expanded',String(open));if(open){close.focus();}else{menu.focus();}}
  menu.addEventListener('click',function(){setMenu(!document.body.classList.contains('mc-nav-open'));});close.addEventListener('click',function(){setMenu(false);});overlay.addEventListener('click',function(){setMenu(false);});
  document.addEventListener('keydown',function(e){
    if(!document.body.classList.contains('mc-nav-open'))return;
    if(e.key==='Escape'){setMenu(false);return;}
    if(e.key==='Tab'){var items=Array.from(sidebar.querySelectorAll('a,button')).filter(function(el){return el.getClientRects().length>0;});var first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
  });
  var narrow=window.matchMedia('(max-width: 900px)');
  narrow.addEventListener('change',function(e){if(!e.matches){document.body.classList.remove('mc-nav-open');menu.setAttribute('aria-expanded','false');}});
  if(key==='dashboard'){
    var needs=document.getElementById('needsAttentionCard');
    var quick=Array.from(content.querySelectorAll('.a-card')).find(function(el){var h=el.querySelector('h2');return h&&h.textContent==='Quick Actions';});
    if(needs&&quick){var grid=document.createElement('div');grid.className='mc-action-grid';needs.before(grid);grid.append(needs,quick);}
    var nav=document.createElement('nav');nav.className='mc-workspaces';nav.setAttribute('aria-label','Featured workspaces');
    [['curriculum','Curriculum','Build confidence in every classroom','Explore lessons'],['morning-boost','Morning Boost','Make a positive start possible','Open the studio'],['campaigns','Campaigns','Bring more people into the mission','Manage campaigns']].forEach(function(item){var a=document.createElement('a');a.href='admin-'+item[0]+'.html';a.innerHTML='<span class="mc-workspace-name">'+item[1]+'</span><span>'+item[2]+'</span><strong>'+item[3]+' <span aria-hidden="true">↗</span></strong>';nav.appendChild(a);});
    hero.after(nav);
  }
  if(key.indexOf('morning-boost')===0){var tabs=document.createElement('nav');tabs.className='mc-section-tabs';tabs.setAttribute('aria-label','Morning Boost workspace');[['morning-boost','Studio'],['morning-boost-calendar','Calendar'],['morning-boost-email','Email & schedule']].forEach(function(item){var a=document.createElement('a');a.href='admin-'+item[0]+'.html';a.textContent=item[1];if(item[0]===key)a.setAttribute('aria-current','page');tabs.appendChild(a);});hero.after(tabs);}
  // Wrap both initial and asynchronously-rendered data tables without replacing nodes.
  function wrapTables(){content.querySelectorAll('table').forEach(function(table){if(table.closest('.mc-table-scroll')||table.closest('.a-modal'))return;var wrap=document.createElement('div');wrap.className='mc-table-scroll';wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label',(table.getAttribute('aria-label')||title.textContent)+' table, scroll horizontally if needed');table.before(wrap);wrap.appendChild(table);});}
  wrapTables();new MutationObserver(wrapTables).observe(content,{childList:true,subtree:true});
  var foot=document.createElement('footer');foot.className='mc-footer';foot.innerHTML='<span>Every login moves the mission forward.</span><span>Fixer Nation Education</span>';content.appendChild(foot);
})();
