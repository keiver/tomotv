//
//  TopShelfReload.m
//  TomoTV
//
//  Objective-C export of the TopShelfReload Swift module to React Native.
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE (TopShelfReload, NSObject)

RCT_EXTERN_METHOD(reload
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

@end
