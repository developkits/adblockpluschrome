/*
 * This file is part of Adblock Plus <https://adblockplus.org/>,
 * Copyright (C) 2006-present eyeo GmbH
 *
 * Adblock Plus is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * Adblock Plus is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Adblock Plus.  If not, see <http://www.gnu.org/licenses/>.
 */

"use strict";

const shareURL = "https://adblockplus.org/";
const messageMark = {};

const shareLinks = {
  facebook: ["https://www.facebook.com/dialog/feed", {
    app_id: "475542399197328",
    link: shareURL,
    redirect_uri: "https://www.facebook.com/",
    ref: "adcounter",
    name: messageMark,
    actions: JSON.stringify([
      {
        name: browser.i18n.getMessage("stats_share_download"),
        link: shareURL
      }
    ])
  }],
  gplus: ["https://plus.google.com/share", {
    url: shareURL
  }],
  twitter: ["https://twitter.com/intent/tweet", {
    text: messageMark,
    url: shareURL,
    via: "AdblockPlus"
  }]
};

let tab = null;

function getPref(key, callback)
{
  browser.runtime.sendMessage({type: "prefs.get", key}, callback);
}

function setPref(key, value, callback)
{
  browser.runtime.sendMessage({type: "prefs.set", key, value}, callback);
}

function togglePref(key, callback)
{
  browser.runtime.sendMessage({type: "prefs.toggle", key}, callback);
}

function isPageWhitelisted(callback)
{
  browser.runtime.sendMessage({type: "filters.isWhitelisted", tab}, callback);
}

function whenPageReady()
{
  return new Promise(resolve =>
  {
    function onMessage(message, sender)
    {
      if (message.type == "composer.ready" && sender.page &&
          sender.page.id == tab.id)
      {
        browser.runtime.onMessage.removeListener(onMessage);
        resolve();
      }
    }

    browser.runtime.onMessage.addListener(onMessage);

    browser.runtime.sendMessage({
      type: "composer.isPageReady",
      pageId: tab.id
    },
    ready =>
    {
      if (ready)
      {
        browser.runtime.onMessage.removeListener(onMessage);
        resolve();
      }
    });
  });
}

function toggleEnabled()
{
  let disabled = document.body.classList.toggle("disabled");
  browser.runtime.sendMessage({
    type: disabled ? "filters.whitelist" : "filters.unwhitelist",
    tab
  });
}

function activateClickHide()
{
  document.body.classList.add("clickhide-active");
  browser.tabs.sendMessage(tab.id, {
    type: "composer.content.startPickingElement"
  });

  // Close the popup after a few seconds, so user doesn't have to
  activateClickHide.timeout = window.setTimeout(window.close, 5000);
}

function cancelClickHide()
{
  if (activateClickHide.timeout)
  {
    window.clearTimeout(activateClickHide.timeout);
    activateClickHide.timeout = null;
  }
  document.body.classList.remove("clickhide-active");
  browser.tabs.sendMessage(tab.id, {type: "composer.content.finished"});
}

function toggleCollapse(event)
{
  let collapser = event.currentTarget;
  let collapsible = document.getElementById(collapser.dataset.collapsible);
  collapsible.classList.toggle("collapsed");
  togglePref(collapser.dataset.option);
}

function getDocLinks(notification)
{
  if (!notification.links)
    return Promise.resolve([]);

  return Promise.all(
    notification.links.map(link =>
    {
      return new Promise((resolve, reject) =>
      {
        browser.runtime.sendMessage({
          type: "app.get",
          what: "doclink",
          link
        }, resolve);
      });
    })
  );
}

function insertMessage(element, text, links)
{
  let match = /^(.*?)<(a|strong)>(.*?)<\/\2>(.*)$/.exec(text);
  if (!match)
  {
    element.appendChild(document.createTextNode(text));
    return;
  }

  let before = match[1];
  let tagName = match[2];
  let value = match[3];
  let after = match[4];

  insertMessage(element, before, links);

  let newElement = document.createElement(tagName);
  if (tagName == "a" && links && links.length)
    newElement.href = links.shift();
  insertMessage(newElement, value, links);
  element.appendChild(newElement);

  insertMessage(element, after, links);
}

function createShareLink(network, blockedCount)
{
  let url = shareLinks[network][0];
  let params = shareLinks[network][1];

  let querystring = [];
  for (let key in params)
  {
    let value = params[key];
    if (value == messageMark)
      value = browser.i18n.getMessage("stats_share_message", blockedCount);
    querystring.push(
      encodeURIComponent(key) + "=" + encodeURIComponent(value)
    );
  }
  return url + "?" + querystring.join("&");
}

function updateStats()
{
  let statsPage = document.getElementById("stats-page");
  browser.runtime.sendMessage({
    type: "stats.getBlockedPerPage",
    tab
  },
  blockedPage =>
  {
    ext.i18n.setElementText(statsPage, "stats_label_page",
                            [blockedPage.toLocaleString()]);
  });

  let statsTotal = document.getElementById("stats-total");
  getPref("blocked_total", blockedTotal =>
  {
    ext.i18n.setElementText(statsTotal, "stats_label_total",
                            [blockedTotal.toLocaleString()]);
  });
}

function share(event)
{
  getPref("blocked_total", blockedTotal =>
  {
    // Easter Egg
    if (blockedTotal <= 9000 || blockedTotal >= 10000)
    {
      blockedTotal = blockedTotal.toLocaleString();
    }
    else
    {
      blockedTotal = browser.i18n.getMessage("stats_over",
                                            (9000).toLocaleString());
    }

    browser.tabs.create({
      url: createShareLink(event.target.dataset.social, blockedTotal)
    });
  });
}

function toggleIconNumber()
{
  togglePref("show_statsinicon", showStatsInIcon =>
  {
    document.getElementById("show-iconnumber").setAttribute(
      "aria-checked", showStatsInIcon
    );
  });
}

document.addEventListener("DOMContentLoaded", () =>
{
  browser.tabs.query({active: true, lastFocusedWindow: true}, tabs =>
  {
    if (tabs.length > 0)
      tab = {id: tabs[0].id, url: tabs[0].url};

    let urlProtocol = tab && tab.url && new URL(tab.url).protocol;

    // Mark page as 'local' to hide non-relevant elements
    if (urlProtocol != "http:" && urlProtocol != "https:")
    {
      document.body.classList.add("local");
      document.body.classList.remove("nohtml");
    }
    else
    {
      whenPageReady().then(() =>
      {
        document.body.classList.remove("nohtml");
      });
    }

    // Ask content script whether clickhide is active. If so, show
    // cancel button.  If that isn't the case, ask background.html
    // whether it has cached filters. If so, ask the user whether she
    // wants those filters. Otherwise, we are in default state.
    if (tab)
    {
      isPageWhitelisted(whitelisted =>
      {
        if (whitelisted)
          document.body.classList.add("disabled");
      });

      browser.tabs.sendMessage(tab.id, {
        type: "composer.content.getState"
      },
      response =>
      {
        if (response && response.active)
          document.body.classList.add("clickhide-active");
      });
    }

    updateStats();
    document.getElementById("stats-container").removeAttribute("hidden");
  });

  document.getElementById("enabled").addEventListener(
    "click", toggleEnabled
  );
  document.getElementById("clickhide").addEventListener(
    "click", activateClickHide
  );
  document.getElementById("clickhide-cancel").addEventListener(
    "click", cancelClickHide
  );
  document.getElementById("options").addEventListener("click", () =>
  {
    browser.runtime.sendMessage({type: "app.open", what: "options"});
    window.close();
  });

  // Set up collapsing of menu items
  for (let collapser of document.getElementsByClassName("collapse"))
  {
    collapser.addEventListener("click", toggleCollapse);
    getPref(collapser.dataset.option, value =>
    {
      if (value)
      {
        document.getElementById(
          collapser.dataset.collapsible
        ).classList.remove("collapsed");
      }
    });
  }

  document.getElementById("share-box").addEventListener("click", share);
  let showIconNumber = document.getElementById("show-iconnumber");
  getPref("show_statsinicon", showStatsInIcon =>
  {
    showIconNumber.setAttribute("aria-checked", showStatsInIcon);
  });
  showIconNumber.addEventListener("click", toggleIconNumber);
  document.querySelector("label[for='show-iconnumber']").addEventListener(
    "click", toggleIconNumber
  );
});

window.addEventListener("load", () =>
{
  browser.runtime.sendMessage({
    type: "notifications.get",
    displayMethod: "popup"
  }, notification =>
  {
    if (!notification)
      return;

    let titleElement = document.getElementById("notification-title");
    let messageElement = document.getElementById("notification-message");

    titleElement.textContent = notification.texts.title;

    getDocLinks(notification).then(docLinks =>
    {
      insertMessage(messageElement, notification.texts.message, docLinks);

      messageElement.addEventListener("click", event =>
      {
        let link = event.target;
        while (link && link != messageElement && link.localName != "a")
          link = link.parentNode;
        if (!link)
          return;
        event.preventDefault();
        event.stopPropagation();
        browser.tabs.create({url: link.href});
      });
    });

    let notificationElement = document.getElementById("notification");
    notificationElement.className = notification.type;
    notificationElement.hidden = false;
    notificationElement.addEventListener("click", event =>
    {
      if (event.target.id == "notification-close")
        notificationElement.classList.add("closing");
      else if (event.target.id == "notification-optout" ||
               event.target.id == "notification-hide")
      {
        if (event.target.id == "notification-optout")
          setPref("notifications_ignoredcategories", true);

        notificationElement.hidden = true;
        notification.onClicked();
      }
    }, true);
  });
});
