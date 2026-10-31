//
//  SubtitleSearch.m
//  TomoTV
//
//  Objective-C export of the SubtitleSearch Swift module to React Native.
//

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE (SubtitleSearch, RCTEventEmitter)

RCT_EXTERN_METHOD(present
                  : (NSDictionary *)state resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(update
                  : (NSDictionary *)state resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(dismiss
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

@end
