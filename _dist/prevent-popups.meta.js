// ==UserScript==
// @name         Autotask - Prevent Popups
// @namespace    https://github.com/warthurton/userscripts
// @version      1.0.1
// @modified     2026-04-20T21:57:58.210Z
// @description  Prevents Autotask tickets, tasks, and KB articles from opening in popup windows by redirecting to proper MVC URLs
// @author       warthurton
// @match        https://ww*.autotask.net/Autotask/AutotaskExtend/ExecuteCommand.aspx*
// @match        https://ww*.autotask.net/Mvc/ServiceDesk/TicketDetail.mvc?*workspace=False*
// @match        https://ww*.autotask.net/Mvc/Projects/TaskDetail.mvc?*workspace=False*
// @match        https://ww*.autotask.net/Mvc/Knowledgebase/ArticleDetail.mvc?*workspace=False*
// @icon         https://favicons-blue.vercel.app/?domain=autotask.net
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/warthurton/userscripts/main/_dist/prevent-popups.meta.js
// @downloadURL  https://raw.githubusercontent.com/warthurton/userscripts/main/_dist/prevent-popups.user.js
// @homepageURL  https://github.com/warthurton/userscripts
// @supportURL   https://github.com/warthurton/userscripts/issues
// ==/UserScript==
