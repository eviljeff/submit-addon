import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream";
import { promisify } from "node:util";

import fetch, { FormData, fileFromSync } from "node-fetch";
import { Response } from "node-fetch";
import defaultJwt from "jsonwebtoken";

type ClientConstructorParams = {
  apiKey: string;
  apiSecret: string;
  apiUrlPrefix: string;
  apiJwtExpiresIn?: number;
  debugLogging?: boolean;
  validationCheckInterval?: number;
  validationCheckTimeout?: number;
  approvalCheckInterval?: number;
  approvalCheckTimeout?: number;
  logger?: any;
  downloadDir?: string;
};

export default class Client {
  apiKey: string;
  apiSecret: string;
  apiUrlPrefix: string;
  apiJwtExpiresIn: number;
  debugLogging: boolean;
  validationCheckInterval: number;
  validationCheckTimeout: number;
  approvalCheckInterval: number;
  approvalCheckTimeout: number;
  logger: any;
  downloadDir: string;

  constructor({
    apiKey,
    apiSecret,
    apiUrlPrefix,
    apiJwtExpiresIn = 60 * 5, // 5 minutes
    debugLogging = false,
    validationCheckInterval = 1000,
    validationCheckTimeout = 300000, // 5 minutes.
    approvalCheckInterval = 1000,
    approvalCheckTimeout = 900000, // 15 minutes.
    logger = console,
    downloadDir = process.cwd(),
  }: ClientConstructorParams) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.apiUrlPrefix = apiUrlPrefix;
    this.apiJwtExpiresIn = apiJwtExpiresIn;
    this.validationCheckInterval = validationCheckInterval;
    this.validationCheckTimeout = validationCheckTimeout;
    this.approvalCheckInterval = approvalCheckInterval;
    this.approvalCheckTimeout = approvalCheckTimeout;
    this.debugLogging = debugLogging;
    this.logger = logger;
    this.downloadDir = downloadDir;
  }

  doUploadSubmit(xpi: string, channel: string): Promise<Response> {
    const url = `${this.apiUrlPrefix}addons/upload/`;
    const formData = new FormData();
    formData.set("channel", channel);
    formData.set("upload", fileFromSync(xpi));
    return this.fetch(url, "POST", formData);
  }

  waitForValidation(
    data: any,
    _clearTimeout: typeof clearTimeout = clearTimeout,
    _setAbortTimeout: typeof setTimeout = setTimeout,
    _setValidationCheckTimeout: typeof setTimeout = setTimeout
  ): Promise<string> {
    let validationCheckTimeout: NodeJS.Timer;

    return new Promise((resolve, reject) => {
      if (!data.uuid) {
        return reject(new Error(data));
      }
      const uploadDetailUrl = `${this.apiUrlPrefix}addons/upload/${data.uuid}/`;
      const abortTimeout = _setAbortTimeout(() => {
        _clearTimeout(validationCheckTimeout);

        reject(new Error("Validation Timeout."));
      }, this.validationCheckTimeout);

      const pollValidationStatus = async () => {
        try {
          const detailResponse: Response = await this.fetch(uploadDetailUrl);
          if (!detailResponse.ok) {
            reject(
              new Error(
                `Getting upload details failed: ${detailResponse.statusText}.`
              )
            );
          }
          const detailResponseData: any = await detailResponse.json();

          if (detailResponseData.processed) {
            this.logger.log(
              "Validation results:",
              detailResponseData.validation
            );
            if (detailResponseData.valid) {
              resolve(detailResponseData.uuid);
            } else {
              this.logger.log("Validation failed.");
              _clearTimeout(abortTimeout);

              reject(new Error(detailResponseData.url));
            }
          } else {
            // Validation is still in progress, so wait for a while and try again.
            validationCheckTimeout = _setValidationCheckTimeout(
              pollValidationStatus,
              this.validationCheckInterval
            );
          }
        } catch (err) {
          _clearTimeout(abortTimeout);
          reject(err);
        }
      };

      pollValidationStatus();
    });
  }

  doNewAddonSubmit(metaDataJSON: any, uuid: string): Promise<Response> {
    const url = `${this.apiUrlPrefix}addons/addon/`;
    const jsonData = { version: { upload: uuid }, ...metaDataJSON };
    return this.fetch(url, "POST", JSON.stringify(jsonData));
  }

  doNewVersionSubmit(
    addonId: string,
    metaDataJSON: any,
    uuid: string
  ): Promise<Response> {
    const url = `${this.apiUrlPrefix}addons/addon/${addonId}/versions/`;
    const jsonData = { upload: uuid, ...metaDataJSON };
    return this.fetch(url, "POST", JSON.stringify(jsonData));
  }

  waitForApproval(
    extractFileFromData: Function,
    detailUrl: string,
    _clearTimeout: typeof clearTimeout = clearTimeout,
    _setAbortTimeout: typeof setTimeout = setTimeout,
    _setApprovalCheckTimeout: typeof setTimeout = setTimeout
  ): Promise<string> {
    let approvalCheckTimeout: NodeJS.Timer;

    return new Promise((resolve, reject) => {
      const abortTimeout = _setAbortTimeout(() => {
        _clearTimeout(approvalCheckTimeout);

        reject(new Error("Approval Timeout."));
      }, this.approvalCheckTimeout);

      const pollApprovalStatus = async () => {
        try {
          const detailResponse: Response = await this.fetch(detailUrl);
          if (!detailResponse.ok) {
            return reject(new Error("Getting addon details failed."));
          }
          const detailResponseData: any = await detailResponse.json();

          const file = extractFileFromData(detailResponseData);
          if (file.status === "public") {
            resolve(file.url);
          } else {
            // The add-on hasn't been approved yet, so wait for a while and try again.
            approvalCheckTimeout = _setApprovalCheckTimeout(
              pollApprovalStatus,
              this.approvalCheckInterval
            );
          }
        } catch (err) {
          _clearTimeout(abortTimeout);
          reject(err);
        }
      };

      pollApprovalStatus();
    });
  }

  getJson(response: Response): Promise<any> {
    return new Promise(async (resolve, reject) => {
      if (response.status < 100 || response.status >= 500) {
        reject(new Error(`Getting response failed: ${response.statusText}.`));
      } else {
        const data = await response.json();
        if (!response.ok) {
          this.logger.log(data);
          reject(new Error("Bad Request"));
        } else {
          resolve(data);
        }
      }
    });
  }

  saveFile(response: Response): Promise<any> {
    if (!response.ok || !response.body) {
      return new Promise((resolve, reject) =>
        reject(
          new Error(`Download of signed xpi failed: ${response.statusText}.`)
        )
      );
    }
    const dest = `${this.downloadDir}/the.xpi`;
    return promisify(pipeline)(response.body, createWriteStream(dest));
  }

  fetch(
    url: string,
    method = "GET",
    body?: FormData | string,
    jwt = defaultJwt
  ): Promise<Response> {
    const authToken = jwt.sign({ iss: this.apiKey }, this.apiSecret, {
      algorithm: "HS256",
      expiresIn: this.apiJwtExpiresIn,
    });

    this.logger.log(`Fetching URL: ${url}`);
    let headers;
    if (typeof body === "string") {
      headers = {
        Authorization: `JWT ${authToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      };
    } else {
      headers = {
        Authorization: `JWT ${authToken}`,
        Accept: "application/json",
      };
    }
    return fetch(url, { method, body, headers });
  }

  submitAddon(
    xpi: string,
    channel: string,
    metaDataJSON: any
  ): Promise<Response> {
    const extractFileFromData = (data: any): any => {
      return channel === "listed"
        ? data.current_version.file
        : data.latest_unlisted_version.file;
    };
    const getDetailUrl = (data: any): Promise<string> =>
      new Promise((resolve, reject) =>
        resolve(`${this.apiUrlPrefix}addons/addon/${data.slug}/`)
      );

    return this.doUploadSubmit(xpi, channel)
      .then(this.getJson.bind(this))
      .then(this.waitForValidation.bind(this))
      .then(this.doNewAddonSubmit.bind(this, metaDataJSON))
      .then(this.getJson.bind(this))
      .then(getDetailUrl)
      .then(this.waitForApproval.bind(this, extractFileFromData))
      .then(this.fetch.bind(this)) // download the xpi
      .then(this.saveFile.bind(this));
  }

  submitVersion(
    xpi: string,
    channel: string,
    addonId: string,
    metaDataJSON: any
  ): Promise<Response> {
    const extractFileFromData = (data: any) => data.file;
    const getDetailUrl = (data: any): Promise<string> =>
      new Promise((resolve, reject) =>
        resolve(
          `${this.apiUrlPrefix}addons/addon/${addonId}/versions/${data.id}/`
        )
      );

    return this.doUploadSubmit(xpi, channel)
      .then(this.getJson.bind(this))
      .then(this.waitForValidation.bind(this))
      .then(this.doNewVersionSubmit.bind(this, addonId, metaDataJSON))
      .then(this.getJson.bind(this))
      .then(getDetailUrl)
      .then(this.waitForApproval.bind(this, extractFileFromData))
      .then(this.fetch.bind(this)) // download the xpi
      .then(this.saveFile.bind(this));
  }
}
