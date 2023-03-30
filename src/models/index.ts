import {AxiosRequestConfig, AxiosRequestHeaders, AxiosResponse} from 'axios';

export interface CollectorOptions {
    collectRequests?: number;
    collectErrors?: number;
}

export interface AxiosWrapperOptions {
    config?: AxiosRequestConfig;
    apiEndpoint?: string;
    collector?: CollectorOptions;
}

export interface CollectedRequestInfo {
    method: AxiosRequestConfig['method'];
    url: string;
    time: {start: number; end: number};
    status?: number;
    size: number;
    requestData: any;
    responseData: any;
    isError: boolean;
    isCancelled: boolean;
}

export interface RequestInfoToCollect {
    method: AxiosRequestConfig['method'];
    url: string;
    data: any;
    requestStart: number;
    response?: AxiosResponse<any>;
    responseError?: unknown;
    error?: boolean;
    cancelled?: boolean;
}

export interface ApiMethodParams {
    method: AxiosRequestConfig['method'];
    url: string;
    data?: unknown;
    params?: AxiosRequestConfig['params'];
    retries?: number;
    options?: {
        concurrentId?: string;
        collectRequest?: boolean;
        timeout?: number;
        headers?: AxiosRequestHeaders;
        requestConfig?: Record<string, unknown>;
        onDownloadProgress?: AxiosRequestConfig['onDownloadProgress'];
    };
}
