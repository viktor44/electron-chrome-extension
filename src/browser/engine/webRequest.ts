import { app, webContents } from 'electron';
import enhanceWebRequest from 'electron-better-web-request';
// @ts-ignore
import parse from 'content-security-policy-parser';

import { Protocol } from '../../common';

/**
 * Convert map of policies into content security policy heder value
 *
 * @example
 * Map {
 * 'default-src' => ["'self'"],
 * 'script-src' => ["'unsafe-eval'", 'scripts.com'],
 * 'object-src' => [],
 * 'style-src' => ['styles.biz']
 * } => "default-src 'self'; script-src 'unsafe-eval' scripts.com; object-src; style-src styles.biz"
 *
 * @param { Map<string, string[]> } policies policies as returned by `parse`
 * @return {string} the stringified policies
 */
const stringify = (policies: Map<string, string[]>): string =>
  Array.from(policies.entries())
    .map(
      ([name, value]: [string, string[]]) =>
        `${name} ${value.join(' ')}`
    )
    .join(';');

function getHeaderName(headerName: string, headers?: Record<string, string>): string | undefined {
  if (headers) {
    const lowCaseHeader = headerName.toLowerCase();
    for (const key in headers) {
      if (key.toLowerCase() === lowCaseHeader) {
        return key;
      }
    }
  }
  return undefined;
}

function getHeader(headerName: string, headers?: Record<string, any>): any {
  const realHeaderName = getHeaderName(headerName, headers);
  return headers && realHeaderName ? headers[realHeaderName] : undefined;
}

function setHeader(headerName: string, headerValue: any, headers?: Record<string, any>) {
  if (headers) {
    const realHeaderName = getHeaderName(headerName, headers);
    return {
      ...headers,
      [realHeaderName ? realHeaderName : headerName]: headerValue,
    };
  }
  return headers;
}

const requestIsXhrOrSubframe = (details: Electron.OnBeforeSendHeadersListenerDetails | Electron.OnHeadersReceivedListenerDetails) => {
  const { resourceType } = details;

  const isXhr = resourceType === 'xhr';
  const isSubframe = resourceType === 'subFrame';

  return isXhr || isSubframe;
};

const requestHasExtensionOrigin = (details: Electron.OnBeforeSendHeadersListenerDetails) => {
  const { requestHeaders } = details;
  const origin = getHeader('origin', requestHeaders);
  if (origin) {
    return origin.startsWith(Protocol.Extension);
  }

  return false;
};

const requestIsFromBackgroundPage = (details: Electron.OnBeforeSendHeadersListenerDetails): boolean => {
  const { webContentsId } = details;

  if (webContentsId) {
    const wc = webContents.fromId(webContentsId);

    if (wc) {
      return wc.getURL().startsWith(Protocol.Extension);
    }

    return false;
  }

  return false;
};

const requestIsOption = (details: Electron.OnBeforeSendHeadersListenerDetails) => {
  const { method } = details;
  return method === 'OPTIONS';
};

const requestIsForExtension = (details: Electron.OnBeforeSendHeadersListenerDetails) =>
  requestHasExtensionOrigin(details) && requestIsXhrOrSubframe(details);

const requestsOrigins = new Map<string, string>();

app.on(
  'session-created',
  (session: Electron.Session) => {
    enhanceWebRequest(session);

    session.webRequest.onBeforeSendHeaders(
      // @ts-ignore
      (details: Electron.OnBeforeSendHeadersListenerDetails, callback: Function) => {
        const { id, requestHeaders } = details;

        requestsOrigins.set('' + id, getHeader('origin', requestHeaders));

        if (!requestIsFromBackgroundPage(details)
            && requestIsForExtension(details)
            && !requestIsOption(details)) {
          return callback({
            cancel: false,
            requestHeaders: setHeader('origin', 'null', details.requestHeaders),
          });
        }

        callback({
          cancel: false,
          requestHeaders: details.requestHeaders,
        });
      },
      {
        origin: 'ecx-cors',
      }
    );

    session.webRequest.onHeadersReceived(
      // @ts-ignore
      (details: Electron.OnHeadersReceivedListenerDetails, callback: Function) => {
        const { id } = details;
        let { responseHeaders } = details;

        // Override Content Security Policy Header
        //
        // `chrome-extension://` is registered as privilegied
        // with `webFrame.registerURLSchemeAsPrivileged()`
        // but added iFrames with extension protocol
        // don't bypass top frame CSP frame-src policy
        //
        // ref: https://bugs.chromium.org/p/chromium/issues/detail?id=408932#c35
        // todo: remove this block since Electron 5 fix the problem
        //
        // * Protocol `chrome-extension://` is considered trustworthy
        // ref: https://w3c.github.io/webappsec-secure-contexts/#is-origin-trustworthy
        //
        // * Protocol can bypass secure context check
        // ref: //src/chrome/common/secure_origin_whitelist.cc
        // https://cs.chromium.org/chromium/src/chrome/common/secure_origin_whitelist.cc?l=16
        //
        // * Protocol added to the Renderer Web Secure Context Safelist
        // ref: //src/chrome/renderer/chrome_content_renderer_client.cc
        // https://cs.chromium.org/chromium/src/chrome/renderer/chrome_content_renderer_client.cc?l=428
        //
        // * Protocol should bypass CSP check
        // ref: //src/third_party/blink/renderer/core/frame/csp/content_security_policy.cc?l=706
        // https://cs.chromium.org/chromium/src/third_party/blink/renderer/core/frame/csp/content_security_policy.cc?l=1557
        //
        // * Secure Directive Values
        // ref: //src/extensions/common/csp_validator.cc
        // https://cs.chromium.org/chromium/src/extensions/common/csp_validator.cc?l=256

        const cspHeaderKey = 'content-security-policy';
        const cspPolicyKey = 'frame-src';
        const cspDirective: string = (getHeader(cspHeaderKey, responseHeaders) || [])[0];

        if (cspDirective) {
          // since `content-security-policy-parser@0.6`, `parse` returns a `Map`
          const policies: Map<string, string[]> = parse(cspDirective);
          const frameSrcPolicy = policies.get(cspPolicyKey);

          if (frameSrcPolicy) {
            const policiesWithOverride = new Map(policies);
            policiesWithOverride.set(cspPolicyKey, [...frameSrcPolicy, Protocol.Extension]);

            responseHeaders = setHeader(cspHeaderKey, [stringify(policiesWithOverride)], responseHeaders);
          }
        }
        // End override CSP iframe-src policy

        // // Code block for bypass preflight CORS check like Wavebox is doing it
        // // `chrome-extension://` requests doesn't bypass CORS
        // // check like in Chromium
        // //
        // // refs:
        // // https://fetch.spec.whatwg.org/#cors-check
        // // https://cs.chromium.org/chromium/src/extensions/common/cors_util.h?rcl=faf5cf5cb5985875dedd065d852b35a027e50914&l=21
        // // https://github.com/wavebox/waveboxapp/blob/09f791314e1ecc808cbbf919ac65e5f6dda785bd/src/app/src/Extensions/Chrome/CRExtensionRuntime/CRExtensionBackgroundPage.js#L195
        // // todo(hugo): find a better and understandable solution
        // //    if (requestIsForExtension(details) || allowedOriginIsWildcard) {
        // if (requestIsXhrOrSubframe(details) || allowedOriginIsWildcard) {
        //   responseHeaders = setHeader('access-control-allow-credentials', ['true'], responseHeaders);
        //   responseHeaders = setHeader('access-control-allow-origin', ['*'], responseHeaders);
        // } else {
        //   responseHeaders = setHeader('access-control-allow-credentials', ['true'], responseHeaders);
        // }

        requestsOrigins.delete('' + id);

        callback({
          cancel: false,
          responseHeaders: responseHeaders,
        });
      },
      {
        origin: 'ecx-cors',
      }
    );
  }
);
