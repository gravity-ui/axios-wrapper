import cloneDeep from 'lodash/cloneDeep';
import axios, {AxiosInstance, AxiosRequestConfig, CancelTokenSource} from 'axios';
import {
    ApiMethodParams,
    CollectedRequestInfo,
    CollectorOptions,
    AxiosWrapperOptions,
    RequestInfoToCollect,
} from './models';

export {ApiMethodParams, AxiosWrapperOptions} from './models';

export default class AxiosWrapper {
    static DEFAULT_TIMEOUT = 60000;

    protected readonly _axios: AxiosInstance;

    protected readonly requestTokens: Record<string, CancelTokenSource>;
    protected readonly collectorSettings: CollectorOptions;
    protected readonly collector: {
        errors: CollectedRequestInfo[];
        requests: CollectedRequestInfo[];
    };

    protected apiEndpoint?: string;

    constructor(options: AxiosWrapperOptions = {}) {
        const {config = {}, apiEndpoint = '/api', collector = {}} = options;

        const axiosConfig: AxiosRequestConfig = {
            xsrfCookieName: '',
            timeout: AxiosWrapper.DEFAULT_TIMEOUT,
            withCredentials: true,
            ...config,
        };

        this._axios = axios.create(axiosConfig);
        this._axios.defaults.headers = cloneDeep(this._axios.defaults.headers);
        this.requestTokens = {};
        this.setApiEndpoint(apiEndpoint);
        this.collectorSettings = collector;
        this.collector = {
            errors: [],
            requests: [],
        };
    }

    setApiEndpoint = (endpoint = '') => {
        let preparedEndpoint = endpoint;

        if (typeof location !== 'undefined') {
            preparedEndpoint = preparedEndpoint.replace('%CURRENT_HOST%', location.host);
        }

        this.apiEndpoint = preparedEndpoint;
    };

    setCSRFToken = (token: string) => {
        this._axios.defaults.headers.post['X-CSRF-Token'] = token;
        this._axios.defaults.headers.put['X-CSRF-Token'] = token;
        this._axios.defaults.headers.delete['X-CSRF-Token'] = token;
    };

    setDefaultHeader = ({
        name,
        value,
        methods,
    }: {
        name: string;
        value: string;
        methods?: string[];
    }) => {
        const headers = this._axios.defaults.headers;
        if (Array.isArray(methods)) {
            methods.forEach((method) => {
                if (headers[method]) {
                    headers[method][name] = value;
                }
            });
        } else {
            headers.common[name] = value;
        }
    };

    collectRequest({
        method,
        url,
        data,
        requestStart,
        response,
        responseError,
        error = false,
        cancelled = false,
    }: RequestInfoToCollect) {
        const {collectErrors, collectRequests} = this.collectorSettings;
        if (!(collectErrors || collectRequests)) {
            return;
        }

        const {responseText = '', responseURL = url} = (response && response.request) || {};
        const errorText = error && responseError instanceof Error ? responseError.message : '';
        const request: CollectedRequestInfo = {
            method,
            url: responseURL,
            time: {
                start: requestStart,
                end: Number(new Date()),
            },
            status: response && response.status,
            size: responseText.length,
            requestData: (data && JSON.stringify(data, null, 2)) || '',
            responseData:
                (response && response.data && JSON.stringify(response.data, null, 2)) || errorText,
            isError: error,
            isCancelled: cancelled,
        };

        if (collectErrors && error) {
            this.collector.errors = [...this.collector.errors, request].slice(-collectErrors);
        }
        if (collectRequests) {
            this.collector.requests = [...this.collector.requests, request].slice(-collectRequests);
        }
    }

    getCollectedRequests() {
        return {
            errors: [...this.collector.errors],
            requests: [...this.collector.requests],
        };
    }

    async request<T = any>(methodParams: ApiMethodParams): Promise<T> {
        const {
            method,
            url,
            data = null,
            params,
            options = {},
            retries = 0,
            onDownloadProgress,
        } = methodParams;

        const axiosSettings: AxiosRequestConfig = options.requestConfig || {};
        const {concurrentId, collectRequest = true, timeout, headers} = options;
        if (concurrentId) {
            this.cancelRequest(concurrentId);
            axiosSettings.cancelToken = this.createRequestToken(concurrentId);
        }

        if (headers) {
            axiosSettings.headers = headers;
        }

        if (typeof timeout !== 'undefined') {
            axiosSettings.timeout = timeout;
        }

        const requestStart = Number(new Date());

        const request = {
            method,
            url,
            data,
            params,
            onDownloadProgress,
        };

        try {
            const response = await this._axios.request<T>({
                ...axiosSettings,
                ...request,
            });

            this.clearRequestToken(concurrentId);
            if (collectRequest) {
                this.collectRequest({
                    ...request,
                    requestStart,
                    response,
                });
            }
            return response.data;
        } catch (thrown: any) {
            if (axios.isCancel(thrown)) {
                throw {isCancelled: true, error: thrown};
            } else {
                this.clearRequestToken(concurrentId);
            }

            if (collectRequest) {
                this.collectRequest({
                    ...request,
                    requestStart,
                    response: thrown.response,
                    error: true,
                    cancelled: axios.isCancel(thrown),
                    responseError: thrown,
                });
            }

            return this.handleRequestError(
                thrown.response,
                () => this.request({...methodParams, retries: retries + 1}),
                retries,
                new Error(thrown instanceof Error ? thrown.message : 'Unknown error'),
            ) as Promise<T>;
        }
    }

    cancelRequest(id?: string) {
        if (id && this.requestTokens[id]) {
            this.requestTokens[id].cancel('Concurrent request');
        }
    }

    get<T = any>(
        url: string,
        params: ApiMethodParams['params'],
        options: ApiMethodParams['options'] = {},
        onDownloadProgress,
    ) {
        return this.request<T>({
            method: 'GET',
            url,
            params,
            options,
            onDownloadProgress,
        });
    }

    post<T = any>(
        url: string,
        data: unknown,
        params: ApiMethodParams['params'],
        options: ApiMethodParams['options'] = {},
    ) {
        return this.request<T>({
            method: 'POST',
            url,
            data,
            params,
            options,
        });
    }

    put<T = any>(
        url: string,
        data: unknown,
        params: ApiMethodParams['params'],
        options: ApiMethodParams['options'] = {},
    ) {
        return this.request<T>({
            method: 'PUT',
            url,
            data,
            params,
            options,
        });
    }

    patch<T = any>(
        url: string,
        data: unknown,
        params: ApiMethodParams['params'],
        options: ApiMethodParams['options'] = {},
    ) {
        return this.request<T>({
            method: 'PATCH',
            url,
            data,
            params,
            options,
        });
    }

    delete<T = any>(
        url: string,
        data: unknown,
        params: ApiMethodParams['params'],
        options: ApiMethodParams['options'] = {},
    ) {
        return this.request<T>({
            method: 'DELETE',
            url,
            data,
            params,
            options,
        });
    }

    head<T = any>(
        url: string,
        params: ApiMethodParams['params'],
        options: ApiMethodParams['options'] = {},
    ) {
        return this.request<T>({
            method: 'HEAD',
            url,
            params,
            options,
        });
    }

    apiPath = (path: string) => `${this.apiEndpoint}${path}`;

    protected handleRequestError<T>(
        response: unknown,
        request: () => Promise<T>,
        retries: number,
        error: Error,
    ): Promise<T> | unknown;

    protected handleRequestError(response: unknown) {
        throw response;
    }

    protected createRequestToken(id?: string) {
        if (id) {
            const source = axios.CancelToken.source();
            this.requestTokens[id] = source;
            return source.token;
        } else {
            return undefined;
        }
    }

    protected clearRequestToken(id?: string) {
        if (id && this.requestTokens[id]) {
            delete this.requestTokens[id];
        }
    }
}
