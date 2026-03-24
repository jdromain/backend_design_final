declare module "twilio" {
  namespace twilio {
    export function validateRequest(
      authToken: string,
      signature: string,
      url: string,
      params: any
    ): boolean;

    export namespace twiml {
      class VoiceResponse {
        say(message: string): void;
        hangup(): void;
        dial(options?: { callerId?: string }): Dial;
        toString(): string;
      }

      class Dial {
        sip(uri: string): void;
      }
    }
  }

  function twilio(accountSid: string, authToken: string): TwilioClient;

  export = twilio;

  export interface TwilioClient {
    availablePhoneNumbers(country: string): AvailablePhoneNumbersClient;
    incomingPhoneNumbers: IncomingPhoneNumbersClient;
    sip: SipClient;
    calls(callSid: string): CallInstance;
  }

  export interface AvailablePhoneNumbersClient {
    local: {
      list(options?: { areaCode?: string; limit?: number }): Promise<AvailablePhoneNumber[]>;
    };
  }

  export interface AvailablePhoneNumber {
    phoneNumber: string;
    friendlyName: string;
  }

  export interface IncomingPhoneNumbersClient {
    create(options: {
      phoneNumber: string;
      voiceUrl?: string;
      voiceMethod?: string;
      statusCallback?: string;
      statusCallbackMethod?: string;
      friendlyName?: string;
    }): Promise<IncomingPhoneNumber>;
  }

  export interface IncomingPhoneNumber {
    sid: string;
    phoneNumber: string;
    friendlyName: string;
  }

  export interface SipClient {
    domains: SipDomainsClient;
    credentialLists: SipCredentialListsClient;
  }

  export interface SipDomainsClient {
    create(options: { domainName: string; friendlyName?: string; voiceUrl?: string; voiceMethod?: string }): Promise<SipDomain>;
  }

  export interface SipDomain {
    sid: string;
    domainName: string;
    friendlyName: string;
  }

  export interface SipCredentialListsClient {
    create(options: { friendlyName: string }): Promise<SipCredentialList>;
    (sid: string): SipCredentialListInstance;
  }

  export interface SipCredentialList {
    sid: string;
    friendlyName: string;
  }

  export interface SipCredentialListInstance {
    credentials: SipCredentialsClient;
  }

  export interface SipCredentialsClient {
    create(options: { username: string; password: string }): Promise<SipCredential>;
  }

  export interface SipCredential {
    sid: string;
    username: string;
  }

  export interface CallInstance {
    update(options: { status?: string }): Promise<any>;
  }
}

