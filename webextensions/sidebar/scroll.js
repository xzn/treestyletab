/* ***** BEGIN LICENSE BLOCK ***** 
 * Version: MPL 1.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is the Tree Style Tab.
 *
 * The Initial Developer of the Original Code is YUKI "Piro" Hiroshi.
 * Portions created by the Initial Developer are Copyright (C) 2011-2019
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s): YUKI "Piro" Hiroshi <piro.outsider.reflex@gmail.com>
 *                 wanabe <https://github.com/wanabe>
 *                 Tetsuharu OHZEKI <https://github.com/saneyuki>
 *                 Xidorn Quan <https://github.com/upsuper> (Firefox 40+ support)
 *                 lv7777 (https://github.com/lv7777)
 *
 * ***** END LICENSE BLOCK ******/
'use strict';

import {
  log as internalLogger,
  wait,
  nextFrame,
  configs
} from '/common/common.js';

import * as Constants from '/common/constants.js';
import * as ApiTabs from '/common/api-tabs.js';
import * as TabsStore from '/common/tabs-store.js';
import * as TSTAPI from '/common/tst-api.js';

import Tab from '/common/Tab.js';

import * as Size from './size.js';
import * as EventUtils from './event-utils.js';
import * as BackgroundConnection from './background-connection.js';
import * as SidebarTabs from './sidebar-tabs.js';
import * as CollapseExpand from './collapse-expand.js';

import * as RestoringTabCount from './restoring-tab-count.js';

function log(...args) {
  internalLogger('sidebar/scroll', ...args);
}


let mTabBar;
let mOutOfViewTabNotifier;

export function init(scrollPosition) {
  mTabBar               = document.querySelector('#tabbar');
  mOutOfViewTabNotifier = document.querySelector('#out-of-view-tab-notifier');
  if (typeof scrollPosition == 'number') {
    log('restore scroll position');
    cancelRunningScroll();
    scrollTo({
      position: scrollPosition,
      justNow:  true
    });
  }

  document.addEventListener('wheel', onWheel, { capture: true });
  mTabBar.addEventListener('scroll', onScroll);
  BackgroundConnection.onMessage.addListener(onBackgroundMessage);
  browser.runtime.onMessageExternal.addListener(onMessageExternal);
}

/* basics */

function scrollTo(params = {}) {
  log('scrollTo ', params);
  if (!params.justNow &&
      configs.animation && configs.smoothScrollEnabled)
    return smoothScrollTo(params);

  //cancelPerformingAutoScroll();
  if (params.tab)
    mTabBar.scrollTop += calculateScrollDeltaForTab(params.tab);
  else if (typeof params.position == 'number')
    mTabBar.scrollTop = params.position;
  else if (typeof params.delta == 'number')
    mTabBar.scrollTop += params.delta;
  else
    throw new Error('No parameter to indicate scroll position');
}

function cancelRunningScroll() {
  scrollToTab.stopped = true;
  stopSmoothScroll();
}

function calculateScrollDeltaForTab(tab) {
  tab = Tab.get(tab && tab.id);
  if (!tab || tab.pinned)
    return 0;

  const tabRect       = tab.$TST.element.getBoundingClientRect();
  const containerRect = mTabBar.getBoundingClientRect();
  const offset        = getOffsetForAnimatingTab(tab) + smoothScrollTo.currentOffset;
  let delta = 0;
  if (containerRect.bottom < tabRect.bottom + offset) { // should scroll down
    delta = tabRect.bottom - containerRect.bottom + offset;
  }
  else if (containerRect.top > tabRect.top + offset) { // should scroll up
    delta = tabRect.top - containerRect.top + offset;
  }
  log('calculateScrollDeltaForTab ', tab.id, {
    delta, offset,
    tabTop:          tabRect.top,
    tabBottom:       tabRect.bottom,
    containerBottom: containerRect.bottom
  });
  return delta;
}

export function isTabInViewport(tab) {
  tab = Tab.get(tab && tab.id);
  if (!TabsStore.ensureLivingTab(tab))
    return false;

  if (tab.pinned)
    return true;

  return calculateScrollDeltaForTab(tab) == 0;
}

async function smoothScrollTo(params = {}) {
  log('smoothScrollTo ', params);
  //cancelPerformingAutoScroll(true);

  smoothScrollTo.stopped = false;

  const startPosition = mTabBar.scrollTop;
  let delta, endPosition;
  if (params.tab) {
    delta       = calculateScrollDeltaForTab(params.tab);
    endPosition = startPosition + delta;
  }
  else if (typeof params.position == 'number') {
    endPosition = params.position;
    delta       = endPosition - startPosition;
  }
  else if (typeof params.delta == 'number') {
    endPosition = startPosition + params.delta;
    delta       = params.delta;
  }
  else {
    throw new Error('No parameter to indicate scroll position');
  }
  smoothScrollTo.currentOffset = delta;

  const duration  = params.duration || configs.smoothScrollDuration;
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const radian = 90 * Math.PI / 180;
    const scrollStep = () => {
      if (smoothScrollTo.stopped) {
        smoothScrollTo.currentOffset = 0;
        reject();
        return;
      }
      const nowTime = Date.now();
      const spentTime = nowTime - startTime;
      if (spentTime >= duration) {
        scrollTo({
          position: endPosition,
          justNow: true
        });
        smoothScrollTo.stopped       = true;
        smoothScrollTo.currentOffset = 0;
        resolve();
        return;
      }
      const power        = Math.sin(spentTime / duration * radian);
      const currentDelta = parseInt(delta * power);
      const newPosition  = startPosition + currentDelta;
      scrollTo({
        position: newPosition,
        justNow:  true
      });
      smoothScrollTo.currentOffset = currentDelta;
      nextFrame().then(scrollStep);
    };
    nextFrame().then(scrollStep);
  });
}
smoothScrollTo.currentOffset= 0;

async function smoothScrollBy(delta) {
  return smoothScrollTo({
    position: mTabBar.scrollTop + delta
  });
}

function stopSmoothScroll() {
  smoothScrollTo.stopped = true;
}

/* applications */

export function scrollToNewTab(tab, options = {}) {
  if (!canScrollToTab(tab))
    return;

  if (configs.scrollToNewTabMode == Constants.kSCROLL_TO_NEW_TAB_IF_POSSIBLE) {
    const activeTab = Tab.getActiveTab(TabsStore.getWindow());
    scrollToTab(tab, Object.assign({}, options, {
      anchor:            !activeTab.pinned && isTabInViewport(activeTab) && activeTab,
      notifyOnOutOfView: true
    }));
  }
}

function canScrollToTab(tab) {
  tab = Tab.get(tab && tab.id);
  return (TabsStore.ensureLivingTab(tab) &&
          !tab.hidden);
}

export async function scrollToTab(tab, options = {}) {
  scrollToTab.lastTargetId = null;

  log('scrollToTab to ', tab && tab.id, options.anchor && options.anchor.id, options,
      { stack: configs.debug && new Error().stack });
  cancelRunningScroll();
  if (!canScrollToTab(tab)) {
    log('=> unscrollable');
    return;
  }

  scrollToTab.stopped = false;
  cancelNotifyOutOfViewTab();
  //cancelPerformingAutoScroll(true);

  await nextFrame();
  if (scrollToTab.stopped)
    return;
  cancelNotifyOutOfViewTab();

  const anchorTab = options.anchor;
  const hasAnchor = TabsStore.ensureLivingTab(anchorTab) && anchorTab != tab;
  const openedFromPinnedTab = hasAnchor && anchorTab.pinned;

  if (isTabInViewport(tab) &&
      (!hasAnchor ||
       !openedFromPinnedTab)) {
    log('=> already visible');
    return;
  }

  // wait for one more frame, to start collapse/expand animation
  await nextFrame();
  if (scrollToTab.stopped)
    return;
  cancelNotifyOutOfViewTab();
  scrollToTab.lastTargetId = tab.id;

  if (hasAnchor && !anchorTab.pinned) {
    const targetTabRect = tab.$TST.element.getBoundingClientRect();
    const anchorTabRect = anchorTab.$TST.element.getBoundingClientRect();
    const containerRect = mTabBar.getBoundingClientRect();
    const offset        = getOffsetForAnimatingTab(tab);
    let delta = calculateScrollDeltaForTab(tab);
    if (targetTabRect.top > anchorTabRect.top) {
      log('=> will scroll down');
      const boundingHeight = targetTabRect.bottom - anchorTabRect.top + offset;
      const overHeight     = boundingHeight - containerRect.height;
      if (overHeight > 0) {
        delta -= overHeight;
        if (options.notifyOnOutOfView)
          notifyOutOfViewTab(tab);
      }
      log('calculated result: ', {
        boundingHeight, overHeight, delta,
        container:      containerRect.height
      });
    }
    else if (targetTabRect.bottom < anchorTabRect.bottom) {
      log('=> will scroll up');
      const boundingHeight = anchorTabRect.bottom - targetTabRect.top + offset;
      const overHeight     = boundingHeight - containerRect.height;
      if (overHeight > 0)
        delta += overHeight;
      log('calculated result: ', {
        boundingHeight, overHeight, delta,
        container:      containerRect.height
      });
    }
    await scrollTo(Object.assign({}, options, {
      position: mTabBar.scrollTop + delta
    }));
  }
  else {
    await scrollTo(Object.assign({}, options, {
      tab
    }));
  }
  // A tab can be moved after the tabbar is scrolled to the tab.
  // To retry "scroll to tab" behavior for such cases, we need to
  // keep "last scrolled-to tab" information until the tab is
  // actually moved.
  await wait(configs.autoGroupNewTabsTimeout);
  if (scrollToTab.stopped)
    return;
  const retryOptions = {
    retryCount: options.retryCount || 0,
    anchor:     options.anchor
  };
  if (scrollToTab.lastTargetId == tab.id &&
      !isTabInViewport(tab) &&
      (!options.anchor ||
       !isTabInViewport(options.anchor)) &&
      retryOptions.retryCount < 3) {
    retryOptions.retryCount++;
    return scrollToTab(tab, retryOptions);
  }
  if (scrollToTab.lastTargetId == tab.id)
    scrollToTab.lastTargetId = null;
}
scrollToTab.lastTargetId = null;

function getOffsetForAnimatingTab(tab) {
  const expanding = Tab.getExpandingTabs(tab.windowId, {
    toId:   tab.id,
    normal: true
  });
  const collapsing = Tab.getCollapsingTabs(tab.windowId, {
    toId:   tab.id,
    normal: true
  });
  const numExpandingTabs = expanding.length - collapsing.length;
  return numExpandingTabs * Size.getTabHeight();
}

/*
function scrollToTabSubtree(tab) {
  return scrollToTab(tab.$TST.lastDescendant, {
    anchor:            tab,
    notifyOnOutOfView: true
  });
}

function scrollToTabs(tabs) {
  return scrollToTab(tabs[tabs.length - 1], {
    anchor:            tabs[0],
    notifyOnOutOfView: true
  });
}
*/

export function autoScrollOnMouseEvent(event) {
  if (!mTabBar.classList.contains(Constants.kTABBAR_STATE_OVERFLOW))
    return;

  const tabbarRect = mTabBar.getBoundingClientRect();
  const scrollPixels = Math.round(Size.getTabHeight() * 0.5);
  if (event.clientY < tabbarRect.top + autoScrollOnMouseEvent.areaSize) {
    if (mTabBar.scrollTop > 0)
      mTabBar.scrollTop -= scrollPixels;
  }
  else if (event.clientY > tabbarRect.bottom - autoScrollOnMouseEvent.areaSize) {
    if (mTabBar.scrollTop < mTabBar.scrollTopMax)
      mTabBar.scrollTop += scrollPixels;
  }
}
autoScrollOnMouseEvent.areaSize = 20;


async function notifyOutOfViewTab(tab) {
  tab = Tab.get(tab && tab.id);
  if (RestoringTabCount.hasMultipleRestoringTabs()) {
    log('notifyOutOfViewTab: skip until completely restored');
    wait(100).then(() => notifyOutOfViewTab(tab));
    return;
  }
  await nextFrame();
  cancelNotifyOutOfViewTab();
  if (tab && isTabInViewport(tab))
    return;
  mOutOfViewTabNotifier.classList.add('notifying');
  await wait(configs.outOfViewTabNotifyDuration);
  cancelNotifyOutOfViewTab();
}

function cancelNotifyOutOfViewTab() {
  mOutOfViewTabNotifier.classList.remove('notifying');
}


async function onWheel(event) {
  if (!configs.zoomable &&
      EventUtils.isAccelKeyPressed(event)) {
    event.preventDefault();
    return;
  }

  if (!TSTAPI.isScrollLocked()) {
    cancelRunningScroll();
    return;
  }

  event.stopImmediatePropagation();
  event.preventDefault();

  const tab = EventUtils.getTabFromEvent(event);
  TSTAPI.notifyScrolled({
    tab:             tab,
    scrollContainer: mTabBar,
    event:           event
  });
}

function onScroll(_event) {
  reserveToSaveScrollPosition();
}

function reserveToSaveScrollPosition() {
  if (reserveToSaveScrollPosition.reserved)
    clearTimeout(reserveToSaveScrollPosition.reserved);
  reserveToSaveScrollPosition.reserved = setTimeout(() => {
    delete reserveToSaveScrollPosition.reserved;
    browser.sessions.setWindowValue(
      TabsStore.getWindow(),
      Constants.kWINDOW_STATE_SCROLL_POSITION,
      mTabBar.scrollTop
    ).catch(ApiTabs.createErrorSuppressor());
  }, 150);
}

function reserveToScrollToTab(tab, options = {}) {
  if (reserveToScrollToTab.reserved)
    clearTimeout(reserveToScrollToTab.reserved);
  reserveToScrollToTab.reservedTabId = tab.id;
  reserveToScrollToTab.reservedOptions = options;
  reserveToScrollToTab.reserved = setTimeout(() => {
    const options = reserveToScrollToTab.reservedOptions;
    delete reserveToScrollToTab.reservedTabId;
    delete reserveToScrollToTab.reservedOptions;
    delete reserveToScrollToTab.reserved;
    scrollToTab(tab, options);
  }, 100);
}

function reserveToScrollToNewTab(tab) {
  if (reserveToScrollToNewTab.reserved)
    clearTimeout(reserveToScrollToNewTab.reserved);
  reserveToScrollToNewTab.reservedTabId = tab.id;
  reserveToScrollToNewTab.reserved = setTimeout(() => {
    delete reserveToScrollToNewTab.reservedTabId;
    delete reserveToScrollToNewTab.reserved;
    scrollToNewTab(tab);
  }, 100);
}


function reReserveScrollingForTab(tab) {
  if (reserveToScrollToTab.reservedTabId == tab.id)
    reserveToScrollToTab(tab);
  if (reserveToScrollToNewTab.reservedTabId == tab.id)
    reserveToScrollToNewTab(tab);
}


async function onBackgroundMessage(message) {
  switch (message.type) {
    case Constants.kCOMMAND_NOTIFY_TAB_ATTACHED_COMPLETELY: {
      await Tab.waitUntilTracked([
        message.tabId,
        message.parentId
      ], { element: true });
      const tab = Tab.get(message.tabId);
      const parent = Tab.get(message.parentId);
      if (tab && parent && parent.active)
        reserveToScrollToNewTab(tab);
    }; break;

    case Constants.kCOMMAND_SCROLL_TABBAR:
      switch (String(message.by).toLowerCase()) {
        case 'lineup':
          smoothScrollBy(-Size.getTabHeight() * configs.scrollLines);
          break;

        case 'pageup':
          smoothScrollBy(-mTabBar.getBoundingClientRect().height + Size.getTabHeight());
          break;

        case 'linedown':
          smoothScrollBy(Size.getTabHeight() * configs.scrollLines);
          break;

        case 'pagedown':
          smoothScrollBy(mTabBar.getBoundingClientRect().height - Size.getTabHeight());
          break;

        default:
          switch (String(message.to).toLowerCase()) {
            case 'top':
              smoothScrollTo({ position: 0 });
              break;

            case 'bottom':
              smoothScrollTo({ position: mTabBar.scrollTopMax });
              break;
          }
          break;
      }
      break;

    case Constants.kCOMMAND_NOTIFY_TAB_CREATED: {
      await Tab.waitUntilTracked(message.tabId, { element: true });
      if (message.maybeMoved)
        await SidebarTabs.waitUntilNewTabIsMoved(message.tabId);
      const tab = Tab.get(message.tabId);
      if (configs.animation) {
        wait(10).then(() => { // wait until the tab is moved by TST itself
          const parent = tab.$TST.parent;
          if (parent && parent.$TST.subtreeCollapsed) // possibly collapsed by other trigger intentionally
            return;
          const active = tab.active;
          CollapseExpand.setCollapsed(tab, { // this is called to scroll to the tab by the "last" parameter
            collapsed: false,
            anchor:    Tab.getActiveTab(tab.windowId),
            last:      true
          });
          if (!active)
            notifyOutOfViewTab(tab);
        });
      }
      else {
        if (tab.active ||
            Tab.getActiveTab(tab.windowId).pinned)
          reserveToScrollToNewTab(tab);
        else
          notifyOutOfViewTab(tab);
      }
    }; break;

    case Constants.kCOMMAND_NOTIFY_TAB_ACTIVATED:
    case Constants.kCOMMAND_NOTIFY_TAB_UNPINNED:
      await Tab.waitUntilTracked(message.tabId, { element: true });
      reserveToScrollToTab(Tab.get(message.tabId));
      break;

    case Constants.kCOMMAND_BROADCAST_TAB_STATE: {
      if (!message.tabIds.length ||
          message.tabIds.length > 1 ||
          !message.add ||
          !message.add.includes(Constants.kTAB_STATE_BUNDLED_ACTIVE))
        break;
      await Tab.waitUntilTracked(message.tabIds, { element: true });
      const tab = Tab.get(message.tabIds[0]);
      if (!tab ||
          tab.active)
        break;
      const activeTab = Tab.getActiveTab(tab.windowId);
      reserveToScrollToTab(tab, {
        anchor:            !activeTab.pinned && isTabInViewport(activeTab) && activeTab,
        notifyOnOutOfView: true
      });
    }; break;

    case Constants.kCOMMAND_NOTIFY_TAB_MOVED:
    case Constants.kCOMMAND_NOTIFY_TAB_INTERNALLY_MOVED:
      await Tab.waitUntilTracked(message.tabId, { element: true });
      reReserveScrollingForTab(Tab.get(message.tabId));
      break;
  }
}

function onMessageExternal(message, _aSender) {
  switch (message.type) {
    case TSTAPI.kSCROLL:
      return (async () => {
        const params = {};
        const currentWindow = TabsStore.getWindow();
        if ('tab' in message) {
          await Tab.waitUntilTracked(message.tab, { element: true });
          params.tab = Tab.get(message.tab);
          if (!params.tab || params.tab.windowId != currentWindow)
            return;
        }
        else {
          if (message.window != currentWindow)
            return;
          if ('delta' in message)
            params.delta = message.delta;
          if ('position' in message)
            params.position = message.position;
        }
        return scrollTo(params).then(() => {
          return true;
        });
      })();
  }
}

CollapseExpand.onUpdating.addListener((tab, options) => {
  if (!configs.scrollToExpandedTree)
    return;
  if (options.last)
    scrollToTab(tab, {
      anchor:            isTabInViewport(options.anchor) && options.anchor,
      notifyOnOutOfView: true
    });
});

CollapseExpand.onUpdated.addListener((tab, options) => {
  if (!configs.scrollToExpandedTree)
    return;
  if (options.last)
    scrollToTab(tab, {
      anchor:            isTabInViewport(options.anchor) && options.anchor,
      notifyOnOutOfView: true
    });
  else if (tab.active && !options.collapsed)
    scrollToTab(tab);
});
