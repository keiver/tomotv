//  TopShelfReload.m: React Native bridge for the TopShelfReload Swift module.

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(TopShelfReload, NSObject)

RCT_EXTERN_METHOD(contentDidChange)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

@end
