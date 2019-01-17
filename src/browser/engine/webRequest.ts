import { app } from 'electron';
import { Protocol } from '../../common';

const requestIsXhrOrSubframe = (details: any) => {
  const { resourceType } = details;

  const isXhr = resourceType === 'xhr';
  const isSubframe = resourceType === 'subFrame';

  return isXhr || isSubframe;
};

const requestHasExtensionOrigin = (details: any) => {
  const { headers: { Origin } } = details;

  if (Origin) {
    return Origin.startsWith(Protocol.Extension);
  }

  return false;
};

const requestIsOption = (details: any) => {
  const { method } = details;

  return method === 'OPTIONS';
};

const requestsOrigins = new Map<string, string>();

app.on(
  'session-created',
  (session: Electron.Session) => {
    session.webRequest.onBeforeSendHeaders(
      (details: any, callback: Function) => {
        const { id, headers: { Origin } } = details;

        requestsOrigins.set(id, Origin);

        if (requestIsXhrOrSubframe(details)
          && requestHasExtensionOrigin(details)
          && !requestIsOption(details)) {
          return callback({
            cancel: false,
            requestHeaders: {
              ...details.requestHeaders,
              Origin: ['null'],
            },
          });
        }

        callback({
          cancel: false,
          requestHeaders: {
            ...details.requestHeaders,
          },
        });
      }
    );

    session.webRequest.onHeadersReceived(
      (details: any, callback: Function) => {
        const { id, responseHeaders } = details;

        if (requestIsXhrOrSubframe(details) &&
          requestHasExtensionOrigin(details)) {

          const modifiedHeaders = {
            'access-control-allow-credentials': ['true'],
            'access-control-allow-origin': [requestsOrigins.get(id)],
          };

          return callback({
            cancel: false,
            responseHeaders: {
              ...responseHeaders,
              ...modifiedHeaders,
            },
          });
        }

        if (responseHeaders['access-control-allow-origin'] &&
          responseHeaders['access-control-allow-origin'].includes('*')) {

          return callback({
            cancel: false,
            responseHeaders: {
              ...responseHeaders,
              'access-control-allow-credentials': ['true'],
              'access-control-allow-origin': [requestsOrigins.get(id)],
            },
          });
        }

        requestsOrigins.delete(id);

        callback({ cancel: false, responseHeaders });
      }
    );

    session.webRequest.onErrorOccurred(
      (details: any) => {
        const missable = [
          'net::ERR_CACHE_MISS',
        ];

        const warnable = !missable.includes(details.error);

        if (warnable) {
          // console.error('WebRequest error occured: ', details);
        }
      });
  }
);
