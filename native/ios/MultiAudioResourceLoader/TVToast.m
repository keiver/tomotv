//
//  TVToast.m
//  TomoTV
//
//  React Native bridge for the TVToast Swift module.
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(TVToast, NSObject)

RCT_EXTERN_METHOD(show:(NSString *)message isError:(BOOL)isError)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

@end
